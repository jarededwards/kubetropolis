/* Kubetropolis sim — the API server: the only doorway.
 *
 * Admission advances ONE stage per tick (authn → mutating → validating →
 * toEtcd) so a request is watchable crossing the permit hall. The mutating
 * stage stamps the defaults the manifest did not write — the stamped receipt
 * (mutations[]) is what the M3 trace narrates. Watch fan-out copies committed
 * change records into every matching subscriber's backlog; backlogs drain
 * after watchLatency — one commit, N couriers on N distinct roads.
 */

import { CLAIM_VALUES } from '../core/claims'
import type {
  ApiRequest,
  ApiVerb,
  ChangeRecord,
  ComponentId,
  K8sObject,
  Kind,
  PodObj,
  SimState,
  WatchReg,
} from '../core/types'
import { proposeWrite } from './etcd'
import { uidSeqOf } from './objects'

/** Enter the permit hall. kubectl, desks, and foremen all queue here alike. */
export function submit(state: SimState, verb: ApiVerb, obj: K8sObject, source: ComponentId): void {
  state.api.inflight.push({ verb, obj, source, stage: 'authn', mutations: [] })
}

export function registerWatcher(state: SimState, subscriber: ComponentId, kinds: Kind[]): WatchReg {
  const reg: WatchReg = {
    subscriber,
    kinds,
    sentRev: state.etcd.revision,
    backlog: [],
    needsRelist: false,
  }
  state.api.watchers.push(reg)
  return reg
}

/* ---------------------------------------------------------------------------
 * Stage 2 — admission.
 * -------------------------------------------------------------------------*/

export function stepAdmission(state: SimState): void {
  const still: ApiRequest[] = []
  for (const req of state.api.inflight) {
    if (req.stage === 'authn') {
      req.stage = 'mutating'
      still.push(req)
    } else if (req.stage === 'mutating') {
      if (req.verb === 'create') stampDefaults(state, req)
      req.stage = 'validating'
      still.push(req)
    } else if (req.stage === 'validating') {
      req.stage = 'toEtcd'
      still.push(req)
    } else {
      proposeWrite(state, req)
    }
  }
  state.api.inflight = still
}

/** The desk finishes your manifest: every default you did not write. */
function stampDefaults(state: SimState, req: ApiRequest): void {
  if (req.obj.kind !== 'Pod') return
  const pod = req.obj as PodObj
  const k = state.knobs

  pod.spec.probes.readiness = {
    periodSeconds: k.readinessPeriodSec,
    failureThreshold: k.failureThreshold,
    successThreshold: CLAIM_VALUES.probes.successThreshold,
    initialDelaySeconds: k.initialDelaySec,
  }
  pod.spec.probes.liveness = {
    periodSeconds: k.livenessPeriodSec,
    failureThreshold: k.failureThreshold,
    successThreshold: CLAIM_VALUES.probes.successThreshold,
    initialDelaySeconds: k.initialDelaySec,
  }
  req.mutations.push(
    `probes defaulted: period ${k.readinessPeriodSec}s, failureThreshold ${k.failureThreshold}`,
  )

  pod.spec.tolerations = [
    { key: 'node.kubernetes.io/not-ready', seconds: k.unreachableTolerationSec },
    { key: 'node.kubernetes.io/unreachable', seconds: k.unreachableTolerationSec },
  ]
  req.mutations.push(`tolerations injected: not-ready/unreachable ${k.unreachableTolerationSec}s`)

  pod.spec.tgps = k.tgpsSec
  req.mutations.push(`terminationGracePeriodSeconds defaulted to ${k.tgpsSec}`)

  if (!pod.spec.imagePullPolicy) {
    const untaggedOrLatest = !pod.spec.image.includes(':') || pod.spec.image.endsWith(':latest')
    pod.spec.imagePullPolicy = untaggedOrLatest ? 'Always' : 'IfNotPresent'
    req.mutations.push(`imagePullPolicy defaulted to ${pod.spec.imagePullPolicy}`)
  }

  pod.spec.preStopSleepSec = k.preStopSleepSec
}

/* ---------------------------------------------------------------------------
 * Stage 4 — watch fan-out and delivery.
 * -------------------------------------------------------------------------*/

export function stepWatchFanout(state: SimState, committed: ChangeRecord[]): void {
  if (committed.length === 0) return
  const visibleAt = state.now + state.knobs.watchLatencyMs / 1000
  for (const w of state.api.watchers) {
    for (const rec of committed) {
      if (w.kinds.includes(rec.kind)) w.backlog.push({ rec, visibleAt })
    }
  }
}

export function drainWatchers(state: SimState): void {
  for (const w of state.api.watchers) {
    if (w.needsRelist) {
      relist(state, w)
      continue
    }
    while (w.backlog.length > 0 && w.backlog[0].visibleAt <= state.now) {
      const { rec } = w.backlog.shift()!
      w.sentRev = rec.rev
      deliver(state, w.subscriber, rec)
    }
  }
}

/** A watcher that fell behind compaction re-reads the world instead of the log. */
function relist(state: SimState, w: WatchReg): void {
  w.backlog = []
  w.needsRelist = false
  w.sentRev = state.etcd.revision
  for (const obj of state.etcd.objects.values()) {
    if (!w.kinds.includes(obj.kind)) continue
    deliver(state, w.subscriber, {
      rev: obj.resourceVersion,
      op: 'put',
      uid: obj.uid,
      kind: obj.kind,
      event: 'MODIFIED',
    })
  }
}

/**
 * Informer semantics: delivery is "something changed about this uid" plus the
 * CURRENT materialized object (or its absence). Subscribers keep keys, not
 * payloads.
 */
function deliver(state: SimState, subscriber: ComponentId, rec: ChangeRecord): void {
  const obj = state.etcd.objects.get(rec.uid)

  if (subscriber === 'sched') {
    if (rec.kind !== 'Pod') return
    const pod = obj as PodObj | undefined
    if (!pod || pod.deletionTimestamp || pod.spec.nodeName) return
    if (!state.sched.queue.includes(pod.uid) && !state.sched.backoff.some((b) => b.uid === pod.uid)) {
      state.sched.queue.push(pod.uid)
    }
    return
  }

  if (subscriber === 'ctl.deployment') {
    const ctl = state.controllers.deployment
    if (rec.kind === 'Deployment') enqueue(ctl.workqueue, rec.uid)
    if (rec.kind === 'ReplicaSet' && obj?.ownerUid) {
      if (rec.event === 'ADDED') settleExpectation(state, 'deployment', obj.ownerUid, 'creates')
      enqueue(ctl.workqueue, obj.ownerUid)
    }
    return
  }

  if (subscriber === 'ctl.replicaset') {
    const ctl = state.controllers.replicaset
    if (rec.kind === 'ReplicaSet') enqueue(ctl.workqueue, rec.uid)
    if (rec.kind === 'Pod') {
      const owner = obj?.ownerUid ?? state.podOwners.get(rec.uid)
      if (rec.event === 'ADDED' && owner) settleExpectation(state, 'replicaset', owner, 'creates')
      if (rec.event === 'DELETED' && owner) {
        settleExpectation(state, 'replicaset', owner, 'deletes')
        state.podOwners.delete(rec.uid)
      }
      if (owner) enqueue(ctl.workqueue, owner)
    }
    return
  }

  if (subscriber.startsWith('kubelet.')) {
    const nodeId = subscriber.slice('kubelet.'.length)
    const node = state.nodes.find((n) => n.id === nodeId)
    if (!node || rec.kind !== 'Pod') return
    if (rec.event === 'DELETED') {
      // final removal — clear local runtime if we were running it
      if (node.kubelet.runtime.has(rec.uid)) enqueue(node.kubelet.syncQueue, rec.uid)
      return
    }
    const pod = obj as PodObj | undefined
    if (pod?.spec.nodeName === nodeId) enqueue(node.kubelet.syncQueue, pod.uid)
    return
  }
  // 'ctl.nodelifecycle' is periodic — deliveries only advance sentRev.
}

function enqueue(queue: string[], uid: string): void {
  if (!queue.includes(uid)) queue.push(uid)
}

function settleExpectation(
  state: SimState,
  controller: 'deployment' | 'replicaset',
  ownerUid: string,
  field: 'creates' | 'deletes',
): void {
  const e = state.controllers[controller].expect.get(ownerUid)
  if (!e) return
  e[field] = Math.max(0, e[field] - 1)
  if (e.creates === 0 && e.deletes === 0) state.controllers[controller].expect.delete(ownerUid)
}

/** Deterministic pod pick for DeletePod by exact name, else newest by uid. */
export function findPodByName(state: SimState, name: string): PodObj | undefined {
  let candidate: PodObj | undefined
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod') continue
    if (o.name === name) return o
    if (o.name.startsWith(name)) {
      if (!candidate || uidSeqOf(o.uid) > uidSeqOf(candidate.uid)) candidate = o
    }
  }
  return candidate
}
