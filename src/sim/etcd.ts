/* Kubetropolis sim — etcd, the vault.
 *
 * Honestly simplified per FIDELITY.md: three members, a fixed leader, quorum
 * acks abstracted into one fsync latency, no raft log internals. The claims
 * are the ORDERING: a write waits for quorum+fsync, THEN becomes a revision,
 * THEN fans out to watchers. Nothing observes a write before commit.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { ApiRequest, ChangeRecord, PodObj, SimState, WatchEventType } from '../core/types'
import { pushEvent } from './objects'

/** Chaos-aware effective fsync, model ms. */
export function effectiveFsyncMs(state: SimState): number {
  return state.knobs.chaosEtcdSlow ? 500 : state.knobs.etcdFsyncMs
}

/** Stage 3 entry: the API server forwards an admitted request to the vault. */
export function proposeWrite(state: SimState, req: ApiRequest): void {
  state.etcd.fsyncMs = effectiveFsyncMs(state)
  state.etcd.proposals.push({
    req,
    acks: 2, // quorum of 3 modeled as immediate; latency lives in fsync
    readyAt: state.now + state.etcd.fsyncMs / 1000,
  })
}

/**
 * Commit strictly HEAD-OF-LINE (B5): the raft log is a total order, so a
 * later proposal with a shorter fsync must never overtake an earlier one —
 * even when a chaos knob changes the latency mid-flight. A slow head blocks
 * the line; that is the guarantee, not a bug.
 */
export function stepEtcdCommits(state: SimState): ChangeRecord[] {
  const etcd = state.etcd
  const committed: ChangeRecord[] = []
  while (etcd.proposals.length > 0 && etcd.proposals[0].readyAt <= state.now) {
    const p = etcd.proposals.shift()!
    const rec = applyWrite(state, p.req)
    if (rec) committed.push(rec)
  }
  return committed
}

function applyWrite(state: SimState, req: ApiRequest): ChangeRecord | null {
  const etcd = state.etcd
  const obj = req.obj

  if (req.verb === 'create') {
    etcd.revision += 1
    obj.resourceVersion = etcd.revision
    etcd.objects.set(obj.uid, obj)
    return record(state, 'put', obj.uid, obj.kind, 'ADDED')
  }

  if (req.verb === 'update' || req.verb === 'updateStatus') {
    // A missing uid means the object was deleted while this write was in
    // flight — drop it. Merge semantics stand in for the status subresource +
    // optimistic concurrency: an in-flight clone can never resurrect fields
    // another writer owns, and deletion is irreversible.
    const current = etcd.objects.get(obj.uid)
    if (!current || current.kind !== obj.kind) return null
    const base = structuredClone(current)
    if (req.verb === 'update') {
      // The SERVER owns generation (B2): any actual spec change bumps it —
      // a scale included. What a scale does not change is the pod template,
      // so the pod-template-hash (and thus the rollout story) stands still.
      const specChanged =
        JSON.stringify((current as { spec: unknown }).spec)
        !== JSON.stringify((obj as { spec: unknown }).spec)
      ;(base as { spec: unknown }).spec = structuredClone((obj as { spec: unknown }).spec)
      base.labels = { ...obj.labels }
      if (specChanged) base.generation = current.generation + 1
    } else if ('status' in obj) {
      ;(base as { status: unknown }).status = structuredClone((obj as { status: unknown }).status)
    }
    // deletionTimestamp only ever moves from unset to set, via the delete verb
    base.deletionTimestamp = current.deletionTimestamp
    etcd.revision += 1
    base.resourceVersion = etcd.revision
    etcd.objects.set(base.uid, base)
    return record(state, 'put', base.uid, base.kind, 'MODIFIED')
  }

  if (req.verb === 'delete') {
    const existing = etcd.objects.get(obj.uid)
    if (!existing) return null
    // B7: a REPEAT delete on an already-terminating scheduled pod is a no-op —
    // the impatient second press does not force-kill. (Real: only a SHORTER
    // grace period changes anything; that nuance is skipped, per FIDELITY.md.)
    if (
      existing.kind === 'Pod'
      && existing.deletionTimestamp !== undefined
      && existing.spec.nodeName
    ) {
      return null
    }
    // Graceful pod deletion: the FIRST delete only stamps deletionTimestamp;
    // the kubelet runs termination and files the final 'remove'. A pod that
    // never got a node has no kubelet — it is removed immediately.
    if (existing.kind === 'Pod' && !existing.deletionTimestamp) {
      const pod = structuredClone(existing) as PodObj
      pod.deletionTimestamp = state.now
      if (pod.spec.nodeName) {
        etcd.revision += 1
        pod.resourceVersion = etcd.revision
        etcd.objects.set(pod.uid, pod)
        return record(state, 'put', pod.uid, pod.kind, 'MODIFIED')
      }
    }
    etcd.revision += 1
    etcd.objects.delete(obj.uid)
    return record(state, 'delete', obj.uid, obj.kind, 'DELETED')
  }

  // 'remove' — the kubelet's final act of a graceful termination.
  if (!etcd.objects.has(obj.uid)) return null
  etcd.revision += 1
  etcd.objects.delete(obj.uid)
  return record(state, 'delete', obj.uid, obj.kind, 'DELETED')
}

function record(
  state: SimState,
  op: 'put' | 'delete',
  uid: string,
  kind: ChangeRecord['kind'],
  event: WatchEventType,
): ChangeRecord {
  const rec: ChangeRecord = { rev: state.etcd.revision, op, uid, kind, event }
  state.etcd.log.push(rec)
  return rec
}

/**
 * Stage 9: compaction. The API server requests etcd compaction every 5
 * model-minutes (claims: etcd.compaction); watchers older than the compacted
 * revision must relist — the courier does the walk of shame with a full box.
 */
export function stepCompaction(state: SimState): void {
  const etcd = state.etcd
  if (state.now < etcd.nextCompactionAt) return
  etcd.nextCompactionAt = state.now + CLAIM_VALUES.etcdCompaction.intervalSeconds

  // Compact to the PREVIOUS interval's revision (A1): kube-apiserver's
  // compactor retains ~one interval of watchable history, not zero.
  const before = etcd.compactedRevision
  etcd.compactedRevision = etcd.lastIntervalRevision
  etcd.lastIntervalRevision = etcd.revision
  etcd.log = etcd.log.filter((r) => r.rev > etcd.compactedRevision)

  for (const w of state.api.watchers) {
    if (w.sentRev < etcd.compactedRevision) {
      w.needsRelist = true
    }
  }
  if (etcd.compactedRevision > before) {
    pushEvent(state, 'Normal', 'Compacted', 'etcd', `compacted through revision ${etcd.compactedRevision}`)
  }
}
