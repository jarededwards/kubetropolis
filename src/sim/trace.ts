/* Kubetropolis sim — the flagship trace.
 *
 * A trace is a DERIVATION, not a second simulation: every tick,
 * updateTrace() reads the same SimState everything else reads, captures the
 * transient evidence as it passes (an admission receipt, a scheduler cycle),
 * counts committed writes for the traced family off the etcd log, and
 * advances the narrated stop when the next stop's condition becomes
 * observable. Step mode pauses the WORLD at each fresh stop (knobs.paused),
 * so stepping is deterministic — no wall clock anywhere.
 *
 * The knobs are snapshotted on arm and restored on close: the trace hands
 * the city back exactly as it found it.
 */

import { traceStopBit } from '../core/model-helpers'
import { presentedStages } from '../core/trace-presentation'
import type {
  ActionKind,
  EndpointSliceObj,
  Knobs,
  PodObj,
  SimState,
  TracePlayback,
  TraceRecord,
  TraceStop,
} from '../core/types'
import { findPodByName } from './apiserver'
import { getSlice } from './objects'

export const SLOW_TIMESCALE = 0.05
/** the receipt stop lingers this long after readiness before wrapping up */
const DONE_BEAT_SECONDS = 2

/* ---------------------------------------------------------------------------
 * Lifecycle.
 * -------------------------------------------------------------------------*/

export function armTrace(
  state: SimState,
  action: ActionKind,
  subject: string,
  playback: TracePlayback,
): void {
  const savedKnobs: Knobs = { ...state.knobs }
  const slice = getSlice(state)
  const readyDoors = slice
    ? slice.spec.endpoints.reduce((n, e) => n + (e.conditions.ready ? 1 : 0), 0)
    : 0
  state.trace = {
    action,
    playback,
    stop: 'client',
    visited: traceStopBit('client'),
    startedAt: state.now,
    stopAt: state.now,
    trips: 0,
    rev: 0,
    commitRev: 0,
    scannedRev: state.etcd.revision,
    familyUids: [],
    subject,
    mutations: [],
    watchersNotified: 0,
    watchersTotal: state.api.watchers.length,
    maxBacklog: 0,
    queuePos: 0,
    pendingPods: 0,
    kubeletGapRev: 0,
    syncQueueDepth: 0,
    pullDoneMB: 0,
    pullTotalMB: 0,
    pullWaitSec: 0,
    layersHit: 0,
    layersTotal: 0,
    pullSkipped: false,
    pullSeen: false,
    restarts: 0,
    readyOks: 0,
    nextProbeInSec: 0,
    serviceListed: false,
    desiredReplicas: 1,
    familyPods: 0,
    siblingsAtStop: 0,
    rsCreated: false,
    eventsSince: 0,
    autoPaused: false,
    savedKnobs,
    deleteRev: 0,
    deletedAt: 0,
    withdrawRev: 0,
    withdrawAt: 0,
    districtsProgrammed: 0,
    districtsTotal: state.nodes.length,
    sigtermLandedAt: 0,
    killAtObserved: 0,
    graceRemainingSec: 0,
    cleanExit: false,
    removed: false,
    replacementName: '',
    trafficLive: readyDoors > 0 && state.knobs.reqPerSec > 0,
    misroutedSince: 0,
    misroutedAtStart: state.traffic.misrouted,
    suggestedPreStopSec: 0,
  }

  if (action === 'delete-pod') {
    // The victim already stands: the rail follows a known building from the
    // first frame, and the RS family is on record before the paperwork lands.
    const victim = findPodByName(state, subject)
    if (victim) {
      state.trace.subjectUid = victim.uid
      state.trace.podUid = victim.uid
      state.trace.podName = victim.name
      state.trace.subject = victim.name
      // the victim's district — the camera follows the actual building
      state.trace.chosen = victim.spec.nodeName
      state.trace.familyUids.push(victim.uid)
      if (victim.ownerUid) {
        state.trace.replicaSetUid = victim.ownerUid
        state.trace.familyUids.push(victim.ownerUid)
      }
    }
  }

  applyPlayback(state, playback)
  if (playback === 'step') {
    // Read "You are just a client" first; nothing moves until next().
    state.knobs.paused = true
    state.trace.autoPaused = true
  }
}

export function setTracePlayback(state: SimState, playback: TracePlayback): void {
  const t = state.trace
  if (!t) return
  t.playback = playback
  applyPlayback(state, playback)
}

function applyPlayback(state: SimState, playback: TracePlayback): void {
  if (playback === 'slow') {
    state.knobs.timeScale = SLOW_TIMESCALE
    state.knobs.paused = false
  } else if (playback === 'live') {
    state.knobs.timeScale = 1
    state.knobs.paused = false
  }
  // step: pace is whatever it was; pausing happens at each fresh stop.
}

/** Step mode: resume from the auto-pause and run to the next stop. */
export function resumeTraceStep(state: SimState): void {
  const t = state.trace
  if (!t) return
  if (t.playback !== 'step') t.playback = 'step'
  t.autoPaused = false
  state.knobs.paused = false
}

/** Close the trace and hand every knob back exactly as it was found. */
export function endTrace(state: SimState): void {
  const t = state.trace
  if (!t) return
  Object.assign(state.knobs, t.savedKnobs)
  state.trace = null
}

/* ---------------------------------------------------------------------------
 * Per-tick derivation.
 * -------------------------------------------------------------------------*/

export function updateTrace(state: SimState): void {
  const t = state.trace
  if (!t) return
  scanLog(state, t)
  refreshLive(state, t)

  let guard = 0
  while (guard++ < 20) {
    const next = nextStopOf(t)
    if (!next) break
    if (!conditionMet(state, t, next)) break
    t.stop = next
    t.visited |= traceStopBit(next)
    t.stopAt = state.now
    if (t.playback === 'step') {
      state.knobs.paused = true
      t.autoPaused = true
      break
    }
  }
}

function nextStopOf(t: TraceRecord): TraceStop | null {
  const rail = presentedStages(t.action)
  const i = rail.findIndex((s) => s.stop === t.stop)
  return i >= 0 && i + 1 < rail.length ? rail[i + 1].stop : null
}

/* ---------------------------------------------------------------------------
 * The etcd log is the receipt book: family membership and the trips counter
 * both come from committed revisions, never from intentions.
 * -------------------------------------------------------------------------*/

function scanLog(state: SimState, t: TraceRecord): void {
  const deleteRail = t.action === 'delete-pod'
  const primaryKind = t.action === 'apply-deployment' ? 'Deployment' : 'Pod'
  for (const rec of state.etcd.log) {
    if (rec.rev <= t.scannedRev) continue
    t.scannedRev = rec.rev
    const obj = state.etcd.objects.get(rec.uid)

    if (!deleteRail && !t.subjectUid && rec.op === 'put' && rec.kind === primaryKind && obj) {
      if (obj.name === t.subject || obj.name.startsWith(`${t.subject}-`)) {
        t.subjectUid = rec.uid
        t.commitRev = rec.rev
        t.familyUids.push(rec.uid)
        if (primaryKind === 'Pod') {
          t.podUid = rec.uid
          t.podName = obj.name
        } else {
          t.deploymentUid = rec.uid
          t.desiredReplicas = (obj as { spec: { replicas?: number } }).spec.replicas ?? 1
        }
      }
    }

    if (deleteRail && t.podUid) {
      // The ledger stamps the demolition notice: one put, deletionTimestamp set.
      if (t.deleteRev === 0 && rec.uid === t.podUid && rec.op === 'put') {
        const pod = obj as PodObj | undefined
        if (pod?.deletionTimestamp !== undefined) {
          t.deleteRev = rec.rev
          t.deletedAt = state.now
          // fan-out math runs against the DELETE commit on this rail
          t.commitRev = rec.rev
        }
      }
      // The directory withdraws the door — a slice edition that no longer
      // ready-lists the victim, committed AFTER the notice.
      if (t.deleteRev > 0 && t.withdrawRev === 0 && rec.kind === 'EndpointSlice') {
        const slice = obj as EndpointSliceObj | undefined
        const stillReady = slice?.spec.endpoints.some(
          (e) => e.podUid === t.podUid && e.conditions.ready,
        )
        if (slice && !stillReady) {
          t.withdrawRev = rec.rev
          t.withdrawAt = state.now
        }
      }
      // The site is cleared: the final remove commits.
      if (rec.uid === t.podUid && rec.event === 'DELETED') {
        t.removed = true
        // The backstop never fired if the site cleared before killAt.
        t.cleanExit = t.killAtObserved > 0 && state.now < t.killAtObserved - 0.05
      }
      // The desk files the replacement — a NEW pod under the same contract.
      if (
        t.replicaSetUid &&
        rec.kind === 'Pod' &&
        rec.event === 'ADDED' &&
        rec.uid !== t.podUid &&
        obj?.ownerUid === t.replicaSetUid &&
        !t.familyUids.includes(rec.uid)
      ) {
        t.familyUids.push(rec.uid)
        t.replacementName = obj.name
      }
    }

    if (!deleteRail) {
      if (
        t.deploymentUid &&
        !t.replicaSetUid &&
        rec.kind === 'ReplicaSet' &&
        obj?.ownerUid === t.deploymentUid
      ) {
        t.replicaSetUid = rec.uid
        t.rsCreated = true
        t.familyUids.push(rec.uid)
      }

      if (
        t.replicaSetUid &&
        rec.kind === 'Pod' &&
        rec.op === 'put' &&
        obj?.ownerUid === t.replicaSetUid &&
        !t.familyUids.includes(rec.uid)
      ) {
        t.familyUids.push(rec.uid)
        if (!t.podUid) {
          t.podUid = rec.uid
          t.podName = obj.name
        }
      }
    }

    if (t.familyUids.includes(rec.uid)) {
      t.trips += 1
      t.rev = rec.rev
    }
  }
}

function tracedPod(state: SimState, t: TraceRecord): PodObj | undefined {
  return t.podUid ? (state.etcd.objects.get(t.podUid) as PodObj | undefined) : undefined
}

function refreshLive(state: SimState, t: TraceRecord): void {
  // the admission receipt, captured while the request crosses the hall
  if (!t.subjectUid && t.mutations.length === 0) {
    for (const req of state.api.inflight) {
      const name = (req.obj as { name?: string }).name
      if (
        req.mutations.length > 0 &&
        name !== undefined &&
        (name === t.subject || name.startsWith(`${t.subject}-`))
      ) {
        t.mutations = req.mutations.slice()
      }
    }
  }

  // fan-out: how many couriers have DELIVERED the subject's create so far
  if (t.commitRev > 0) {
    let notified = 0
    let maxBacklog = 0
    for (const w of state.api.watchers) {
      if (w.backlog.length > maxBacklog) maxBacklog = w.backlog.length
      if (w.sentRev >= t.commitRev) notified += 1
    }
    t.watchersNotified = notified
    t.maxBacklog = maxBacklog
  }

  // family census (deployment variant)
  if (t.replicaSetUid) {
    let n = 0
    for (const o of state.etcd.objects.values()) {
      if (o.kind === 'Pod' && o.ownerUid === t.replicaSetUid) n += 1
    }
    t.familyPods = n
    t.siblingsAtStop = Math.max(0, n - 1)
  }

  // the directory's view of the traced door (M6: Services exist now)
  const sliceNow = getSlice(state)
  t.serviceListed = !!(
    t.podUid && sliceNow?.spec.endpoints.some((e) => e.podUid === t.podUid && e.conditions.ready)
  )

  // the newspaper (also after the traced pod is gone — the rail outlives it)
  let since = 0
  for (const e of state.events) if (e.at >= t.startedAt) since += 1
  t.eventsSince = since

  // -- delete rail live evidence (runs to the end of the rail, pod or no pod) --
  if (t.action === 'delete-pod') {
    t.misroutedSince = state.traffic.misrouted - t.misroutedAtStart

    const livePod = tracedPod(state, t)
    const nodeIdOfPod = livePod?.spec.nodeName
    if (nodeIdOfPod && t.podUid) {
      const node = state.nodes.find((n) => n.id === nodeIdOfPod)
      const rt = node?.kubelet.runtime.get(t.podUid)
      if (rt) {
        if (rt.sigtermAt !== undefined && state.now >= rt.sigtermAt && t.sigtermLandedAt === 0) {
          t.sigtermLandedAt = rt.sigtermAt
        }
        if (rt.killAt !== undefined) t.killAtObserved = rt.killAt
        t.graceRemainingSec = rt.killAt !== undefined ? Math.max(0, rt.killAt - state.now) : 0
      }
    }
    if (t.removed) t.graceRemainingSec = 0

    // District signage catching up with the withdrawal, one courier at a time.
    if (t.withdrawRev > 0) {
      let programmed = 0
      for (const node of state.nodes) {
        if (node.proxy.programmedRev >= t.withdrawRev) programmed += 1
      }
      t.districtsProgrammed = programmed
      if (programmed >= t.districtsTotal && t.suggestedPreStopSec === 0) {
        // The whole propagation, measured: notice → every signage updated.
        t.suggestedPreStopSec = Math.max(2, Math.ceil(state.now - t.deletedAt) + 1)
      }
    }
    if (t.suggestedPreStopSec === 0) {
      // Fallback while propagation is still running: base courier pace × the
      // slowest plausible walker, plus a second of margin.
      t.suggestedPreStopSec = Math.max(
        2,
        Math.ceil(((state.knobs.watchLatencyMs / 1000) * 1.5 + 1) * 2),
      )
    }
  }

  const pod = tracedPod(state, t)
  if (!pod) return

  // zoning
  const qi = t.podUid ? state.sched.queue.indexOf(t.podUid) : -1
  t.queuePos = qi >= 0 ? qi + 1 : 0
  t.pendingPods = state.vitals.podsPending
  const cycle = state.sched.cycle
  if (cycle && cycle.podUid === t.podUid && cycle.score && cycle.score.length > 0) {
    t.filter = cycle.filter.map((f) => ({ node: f.node, ok: f.ok, failed: f.failed }))
    t.score = cycle.score.map((s) => ({
      node: s.node,
      leastAllocated: s.leastAllocated,
      imageLocality: s.imageLocality,
      spread: s.spread,
    }))
    t.chosen = cycle.chosen
  }

  // foreman
  const nodeId = pod.spec.nodeName
  if (nodeId) {
    const w = state.api.watchers.find((x) => x.subscriber === `kubelet.${nodeId}`)
    if (w) t.kubeletGapRev = Math.max(0, state.etcd.revision - w.sentRev)
    const node = state.nodes.find((n) => n.id === nodeId)
    if (node) {
      t.syncQueueDepth = node.kubelet.syncQueue.length
      const pull = node.pulls.find((p) => p.podUid === t.podUid)
      if (pull) {
        t.pullSeen = true
        t.pullDoneMB = pull.doneMB
        t.pullTotalMB = pull.totalMB
        t.layersHit = pull.layersHit
        t.layersTotal = pull.layersTotal
        t.pullWaitSec = Math.max(0, (pull.startedAt ?? state.now) - pull.queuedAt)
      } else if (!t.pullSeen && pod.status.container.state !== 'waiting') {
        // it never needed the crane: the image was already on the district shelf
        t.pullSkipped = true
      }
    }
  }

  // probes — counters live in the foreman's LOCAL runtime, not the published
  // status: the kubelet knows things City Hall has not been told yet.
  t.restarts = pod.status.container.restartCount
  if (nodeId) {
    const node = state.nodes.find((n) => n.id === nodeId)
    const rt = t.podUid ? node?.kubelet.runtime.get(t.podUid) : undefined
    if (rt) {
      t.readyOks = rt.readinessSuccesses
      t.nextProbeInSec = Math.max(0, rt.nextProbeAt - state.now)
    }
  }

}

/* ---------------------------------------------------------------------------
 * Stop conditions — each answers "is the next hop observable yet?"
 * -------------------------------------------------------------------------*/

function conditionMet(state: SimState, t: TraceRecord, next: TraceStop): boolean {
  const pod = tracedPod(state, t)
  const deleteRail = t.action === 'delete-pod'
  switch (next) {
    case 'client':
      return true
    case 'admission':
      // The stop is "the desk FINISHES your manifest" — the receipt must exist.
      return t.subjectUid !== undefined || t.mutations.length > 0
    case 'etcd_commit':
      // Delete rail: the ledger stop is the demolition notice committing.
      return deleteRail ? t.deleteRev > 0 : t.subjectUid !== undefined
    case 'watch_fanout':
      return t.commitRev > 0 && (t.watchersNotified > 0 || t.maxBacklog > 0)
    case 'deploy_reconcile':
      return t.rsCreated
    case 'rs_reconcile':
      return t.familyPods >= 1
    case 'sched_queue':
      return t.queuePos > 0 || state.sched.cycle?.podUid === t.podUid || pod?.spec.nodeName !== undefined
    case 'filter_score':
      return t.score !== undefined || pod?.spec.nodeName !== undefined
    case 'bind':
      return pod?.spec.nodeName !== undefined
    case 'kubelet_sees': {
      if (!pod?.spec.nodeName) return false
      if (pod.status.container.state !== 'waiting') return true
      const node = state.nodes.find((n) => n.id === pod.spec.nodeName)
      if (!node || !t.podUid) return false
      return node.kubelet.syncQueue.includes(t.podUid) || node.kubelet.runtime.has(t.podUid)
    }
    case 'image_pull':
      return t.pullSeen || t.pullSkipped
    case 'start_probes':
      return pod?.status.container.state === 'running' || pod?.status.ready === true
    case 'endpoints':
      return pod?.status.ready === true

    /* -- delete rail -- */
    case 'endpoint_withdraw':
      // Honest no-traffic variant: with no directory to withdraw from, the
      // stop reads its "no number listed it" copy and passes immediately.
      return !t.trafficLive || t.withdrawRev > 0 || t.removed
    case 'sigterm':
      return t.sigtermLandedAt > 0 || t.removed
    case 'grace_countdown':
      return t.sigtermLandedAt > 0 || t.removed
    case 'sigkill':
      // The stop renders "not needed — exited clean" when cleanExit is true.
      return t.removed || (t.killAtObserved > 0 && state.now >= t.killAtObserved)
    case 'rs_notices':
      // A bare pod has no owner: nothing files a replacement (copy variant).
      return t.replicaSetUid === undefined ? t.removed : t.replacementName !== ''

    case 'done':
      if (deleteRail) return t.removed && state.now - t.stopAt >= DONE_BEAT_SECONDS
      return t.stop === 'endpoints' && state.now - t.stopAt >= DONE_BEAT_SECONDS
  }
}
