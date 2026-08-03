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
import { getCrd, pushEvent, rng01, uidSeqOf } from './objects'

/**
 * The shack's courier walks the shore road — deliberately the LONGEST watch
 * route in the city (beyond the 1.0–1.5 seeded band every other subscriber
 * draws from). An operator is just a client, far from the control plane.
 */
export const OPERATOR_LATENCY_FACTOR = 1.6

/** Enter the permit hall. kubectl, desks, and foremen all queue here alike. */
export function submit(state: SimState, verb: ApiVerb, obj: K8sObject, source: ComponentId): void {
  state.api.inflight.push({ verb, obj, source, stage: 'authn', mutations: [] })

  // Paperwork on the road: the WRITER travels to the permit desk. kubectl's
  // own arrival is emitted at intake (model.runCommand) on apply.in.
  if (source === 'sched') {
    state.flowOutbox.push({ route: 'bind.zoning', kind: 'bindWrite' })
  } else if (source.startsWith('ctl.')) {
    state.flowOutbox.push({ route: 'workorder.inspect', kind: 'workOrder' })
  } else if (source.startsWith('kubelet.')) {
    const letter = source.slice('kubelet.node-'.length)
    if (letter === 'a' || letter === 'b' || letter === 'c') {
      state.flowOutbox.push({
        route: `heartbeat.${letter}`,
        kind: obj.kind === 'Lease' ? 'heartbeat' : 'workOrder',
      })
    }
  }
}

export function registerWatcher(state: SimState, subscriber: ComponentId, kinds: Kind[]): WatchReg {
  const reg: WatchReg = {
    subscriber,
    kinds,
    sentRev: state.etcd.revision,
    backlog: [],
    // A3: every courier walks its own road at its own (seeded, deterministic)
    // pace, ≥1× base latency — so two subscribers observe the SAME commit at
    // DIFFERENT model times. The delete-race lesson depends on this skew.
    // The operator's road is pinned longest of all (see the constant above).
    latencyFactor: subscriber === 'operator' ? OPERATOR_LATENCY_FACTOR : 1 + rng01(state) * 0.5,
    nextBookmarkAt: 0,
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
      // A CR whose kind nobody registered stops here — the real error shape,
      // verbatim (claims: crd.registration). A law must exist before a permit
      // can cite it.
      if (req.verb === 'create' && req.obj.kind === CLAIM_VALUES.crd.kind && !getCrd(state)) {
        const err = `no matches for kind "${CLAIM_VALUES.crd.kind}" in group "${CLAIM_VALUES.crd.group}"`
        state.api.rejected += 1
        pushEvent(state, 'Warning', 'KindNotRegistered', req.obj.name, err)
        const t = state.trace
        if (t && (req.obj.name === t.subject || t.action === 'apply-lighthouse')) {
          t.rejectedError = err
        }
        continue
      }
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

  // B3b: the real DefaultTolerationSeconds admission plugin injects NoExecute
  // tolerations — which therefore do NOT tolerate the NoSchedule taint a dead
  // node also carries. Key-only matching would re-open scheduling onto it.
  pod.spec.tolerations = [
    { key: 'node.kubernetes.io/not-ready', effect: 'NoExecute', seconds: k.unreachableTolerationSec },
    { key: 'node.kubernetes.io/unreachable', effect: 'NoExecute', seconds: k.unreachableTolerationSec },
  ]
  req.mutations.push(`tolerations injected: not-ready/unreachable NoExecute ${k.unreachableTolerationSec}s`)

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
  const baseSec = state.knobs.watchLatencyMs / 1000
  for (const w of state.api.watchers) {
    // One commit, N couriers, N distinct roads — each at its own pace (A3).
    const visibleAt = state.now + baseSec * w.latencyFactor
    let queued = 0
    for (const rec of committed) {
      if (w.kinds.includes(rec.kind)) {
        w.backlog.push({ rec, visibleAt })
        queued += 1
      }
    }
    if (queued > 0) {
      const route = courierRouteFor(w.subscriber)
      if (route) state.flowOutbox.push({ route, kind: 'watchCourier' })
    }
  }
}

/** Which road this subscriber's courier walks. */
function courierRouteFor(subscriber: ComponentId): string | null {
  if (subscriber === 'sched') return 'watch.sched'
  if (subscriber.startsWith('ctl.')) return 'watch.inspect'
  if (subscriber === 'operator') return 'watch.operator'
  if (subscriber.startsWith('kubelet.node-') || subscriber.startsWith('proxy.node-')) {
    const letter = subscriber.slice(subscriber.indexOf('.node-') + '.node-'.length)
    if (letter === 'a' || letter === 'b' || letter === 'c') return `watch.kubelet.${letter}`
  }
  return null
}

export function drainWatchers(state: SimState): void {
  for (const w of state.api.watchers) {
    if (w.needsRelist) {
      // A relist is a full LIST — a courier hauling the whole box, slower
      // than any single delivery (A1).
      if (w.relistAt === undefined) {
        w.relistAt = state.now + (state.knobs.watchLatencyMs / 1000) * 2 * w.latencyFactor
      }
      if (state.now >= w.relistAt) relist(state, w)
      continue
    }
    while (w.backlog.length > 0 && w.backlog[0].visibleAt <= state.now) {
      const { rec } = w.backlog.shift()!
      w.sentRev = rec.rev
      deliver(state, w.subscriber, rec)
    }
    // Watch bookmarks (A1): idle subscribers advance PERIODICALLY (~60 model
    // s), not instantly — real bookmarks are roughly once a minute and
    // clients may not assume any interval (claims: watch.bookmarks).
    if (state.now >= w.nextBookmarkAt) {
      w.nextBookmarkAt = state.now + CLAIM_VALUES.modelWatch.bookmarkSeconds
      if (w.backlog.length === 0 && w.sentRev < state.etcd.revision) {
        w.sentRev = state.etcd.revision
      }
    }
  }
}

/** A watcher that fell behind compaction re-reads the world instead of the log. */
function relist(state: SimState, w: WatchReg): void {
  w.backlog = []
  w.needsRelist = false
  w.relistAt = undefined
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
    if (rec.kind === 'ReplicaSet' && obj?.ownerUid) enqueue(ctl.workqueue, obj.ownerUid)
    return
  }

  if (subscriber === 'ctl.replicaset') {
    const ctl = state.controllers.replicaset
    if (rec.kind === 'ReplicaSet') enqueue(ctl.workqueue, rec.uid)
    if (rec.kind === 'Pod') {
      const owner = obj?.ownerUid ?? state.podOwners.get(rec.uid)
      if (rec.event === 'DELETED') state.podOwners.delete(rec.uid)
      if (owner) enqueue(ctl.workqueue, owner)
    }
    return
  }

  if (subscriber === 'ctl.endpointslice') {
    const ctl = state.controllers.endpointslice
    // One service, one slice (M6): any relevant change re-checks the directory.
    if (rec.kind === 'Service' || rec.kind === 'EndpointSlice' || rec.kind === 'Pod') {
      enqueue(ctl.workqueue, rec.kind === 'Service' ? rec.uid : 'directory')
    }
    return
  }

  if (subscriber.startsWith('proxy.')) {
    // The district's signage box programs its OWN copy of the directory — at
    // its courier's pace, which is the entire stale-routing lesson.
    const nodeId = subscriber.slice('proxy.'.length)
    const node = state.nodes.find((n) => n.id === nodeId)
    if (!node || rec.kind !== 'EndpointSlice') return
    if (rec.event === 'DELETED') {
      node.proxy = { programmedRev: rec.rev, endpoints: [] }
      return
    }
    const slice = obj as { spec?: { endpoints?: unknown } } | undefined
    if (slice?.spec?.endpoints) {
      node.proxy = {
        programmedRev: (obj as { resourceVersion: number }).resourceVersion,
        endpoints: structuredClone(slice.spec.endpoints) as typeof node.proxy.endpoints,
      }
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

  if (subscriber === 'operator') {
    // The shack holds one watch: its kind, and the law that defines it.
    if (rec.kind === 'Lighthouse' || rec.kind === 'CustomResourceDefinition') {
      if (rec.kind === 'Lighthouse') enqueue(state.controllers.lighthouse.workqueue, rec.uid)
      else {
        // a new law: re-look at every lighthouse (there is at most one)
        for (const o of state.etcd.objects.values()) {
          if (o.kind === 'Lighthouse') enqueue(state.controllers.lighthouse.workqueue, o.uid)
        }
      }
    }
    return
  }
  // 'ctl.nodelifecycle' is periodic — deliveries only advance sentRev.
}

function enqueue(queue: string[], uid: string): void {
  if (!queue.includes(uid)) queue.push(uid)
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
