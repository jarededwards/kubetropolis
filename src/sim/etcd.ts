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

/** Commit every proposal whose quorum+fsync completed. Returns committed records. */
export function stepEtcdCommits(state: SimState): ChangeRecord[] {
  const etcd = state.etcd
  const committed: ChangeRecord[] = []
  if (etcd.proposals.length === 0) return committed

  const still: typeof etcd.proposals = []
  for (const p of etcd.proposals) {
    if (p.readyAt > state.now) {
      still.push(p)
      continue
    }
    const rec = applyWrite(state, p.req)
    if (rec) committed.push(rec)
  }
  etcd.proposals = still
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

  if (req.verb === 'update') {
    // Stale-object tolerance: last write wins on the same uid; a missing uid
    // means the object was deleted while this write was in flight — drop it.
    if (!etcd.objects.has(obj.uid)) return null
    etcd.revision += 1
    obj.resourceVersion = etcd.revision
    etcd.objects.set(obj.uid, obj)
    return record(state, 'put', obj.uid, obj.kind, 'MODIFIED')
  }

  if (req.verb === 'delete') {
    const existing = etcd.objects.get(obj.uid)
    if (!existing) return null
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

  const before = etcd.compactedRevision
  etcd.compactedRevision = etcd.revision
  etcd.log = etcd.log.filter((r) => r.rev > etcd.compactedRevision)

  for (const w of state.api.watchers) {
    if (w.sentRev < etcd.compactedRevision && w.backlog.length === 0 && w.sentRev < etcd.revision) {
      w.needsRelist = true
    }
  }
  if (etcd.compactedRevision > before) {
    pushEvent(state, 'Normal', 'Compacted', 'etcd', `compacted through revision ${etcd.compactedRevision}`)
  }
}
