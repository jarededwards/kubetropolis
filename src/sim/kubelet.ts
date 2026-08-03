/* Kubetropolis sim — the foremen.
 *
 * Each powered district's kubelet: drains its couriers, pulls images from
 * the harbor ONE AT A TIME (claims: images.pullSerialized), builds and
 * starts containers, runs probes on their periods, restarts crashed
 * containers on the doubling backoff ladder (claims: crashloop.backoff),
 * and executes graceful termination (preStop → SIGTERM → grace → SIGKILL).
 *
 * The foreman's LOCAL runtime (timers, probe counters) is distinct from the
 * published status: City Hall learns things only when the kubelet files a
 * status write — through the permit hall like everyone else.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { LocalPodRuntime, NodeSim, PodObj, SimState } from '../core/types'
import { submit } from './apiserver'
import {
  clone,
  CRASH_AFTER_SECONDS,
  CREATE_SECONDS,
  getPod,
  pushEvent,
  TERM_CLEAN_EXIT_SECONDS,
} from './objects'

const SWEEP = CLAIM_VALUES.kubeletHeartbeat.syncFrequencySeconds
const BACKOFF_BASE = CLAIM_VALUES.crashLoop.baseSeconds
const BACKOFF_FACTOR = CLAIM_VALUES.crashLoop.factor
const BACKOFF_CAP = CLAIM_VALUES.crashLoop.capSeconds
const BACKOFF_RESET_AFTER = CLAIM_VALUES.crashLoop.resetAfterCleanSeconds

export function stepKubelets(state: SimState, dt: number): void {
  for (const node of state.nodes) {
    if (!node.powered) continue
    stepPulls(state, node, dt)
    drainSync(state, node)
    if (state.now >= node.kubelet.nextSweepAt) {
      node.kubelet.nextSweepAt = state.now + SWEEP
      for (const uid of node.kubelet.runtime.keys()) {
        if (!node.kubelet.syncQueue.includes(uid)) node.kubelet.syncQueue.push(uid)
      }
    }
    stepTimers(state, node)
  }
}

/* ---------------------------------------------------------------------------
 * Harbor pulls — serialized per district.
 * -------------------------------------------------------------------------*/

function stepPulls(state: SimState, node: NodeSim, dt: number): void {
  // serializeImagePulls (claims: images.pullSerialized): one crane trip at a
  // time per district — everything else waits in the queue.
  const concurrent = CLAIM_VALUES.imagePull.serialized ? 1 : node.pulls.length
  const rate = state.knobs.chaosRegistryOutage ? 0 : state.knobs.registryMBps
  const finished: typeof node.pulls = []
  for (const pull of node.pulls.slice(0, concurrent)) {
    pull.doneMB += rate * dt
    if (pull.doneMB >= pull.totalMB) finished.push(pull)
  }
  for (const pull of finished) {
    node.pulls.splice(node.pulls.indexOf(pull), 1)
    node.imageCache.add(pull.image)
    pushEvent(state, 'Normal', 'Pulled', pull.image, `cargo landed at ${node.id}`)
    const pod = getPod(state, pull.podUid)
    if (pod && pod.spec.nodeName === node.id && !pod.deletionTimestamp) {
      beginCreate(state, node, pod)
    }
  }
}

/* ---------------------------------------------------------------------------
 * Sync queue — react to delivered knowledge.
 * -------------------------------------------------------------------------*/

function drainSync(state: SimState, node: NodeSim): void {
  const queue = node.kubelet.syncQueue
  node.kubelet.syncQueue = []
  for (const uid of queue) {
    const pod = getPod(state, uid)
    if (!pod) {
      node.kubelet.runtime.delete(uid)
      continue
    }
    if (pod.spec.nodeName !== node.id) continue
    syncPod(state, node, pod)
  }
}

function runtimeFor(node: NodeSim, pod: PodObj): LocalPodRuntime {
  let rt = node.kubelet.runtime.get(pod.uid)
  if (!rt) {
    rt = {
      podUid: pod.uid,
      nextProbeAt: 0,
      readinessSuccesses: 0,
      readinessFails: 0,
      livenessFails: 0,
    }
    node.kubelet.runtime.set(pod.uid, rt)
  }
  return rt
}

function syncPod(state: SimState, node: NodeSim, pod: PodObj): void {
  const rt = runtimeFor(node, pod)

  if (pod.deletionTimestamp !== undefined) {
    beginTermination(state, node, pod, rt)
    return
  }

  if (pod.status.container.state === 'waiting' && pod.status.container.backoffUntil === undefined) {
    startupPath(state, node, pod)
  }
}

/** waiting → (pull?) → creating; publishes each transition as a status write. */
function startupPath(state: SimState, node: NodeSim, pod: PodObj): void {
  // A second delivery can arrive before our own status write commits; the
  // local runtime, not the published state, is the re-entrancy guard.
  if (runtimeFor(node, pod).creatingUntil !== undefined) return
  const image = pod.spec.image
  const mustPull = pod.spec.imagePullPolicy === 'Always' || !node.imageCache.has(image)
  if (mustPull) {
    const queued = node.pulls.some((p) => p.podUid === pod.uid)
    if (!queued) {
      node.pulls.push({ image, podUid: pod.uid, totalMB: state.knobs.imageSizeMB, doneMB: 0 })
      publishStatus(state, node, pod, (p) => {
        p.status.container.state = 'pulling'
        p.status.container.reason = 'ContainerCreating'
      })
      pushEvent(state, 'Normal', 'Pulling', pod.name, `requesting ${image} from the harbor`)
    }
    return
  }
  beginCreate(state, node, pod)
}

function beginCreate(state: SimState, node: NodeSim, pod: PodObj): void {
  const rt = runtimeFor(node, pod)
  rt.creatingUntil = state.now + CREATE_SECONDS
  publishStatus(state, node, pod, (p) => {
    p.status.container.state = 'creating'
    p.status.container.reason = 'ContainerCreating'
  })
  pushEvent(state, 'Normal', 'Created', pod.name, 'container created')
}

/* ---------------------------------------------------------------------------
 * Timer-driven work: create completion, probes, crashes, backoff, termination.
 * -------------------------------------------------------------------------*/

function stepTimers(state: SimState, node: NodeSim): void {
  for (const rt of node.kubelet.runtime.values()) {
    const pod = getPod(state, rt.podUid)
    if (!pod) {
      node.kubelet.runtime.delete(rt.podUid)
      continue
    }

    if (pod.deletionTimestamp !== undefined) {
      stepTermination(state, node, pod, rt)
      continue
    }

    // creating → running
    if (rt.creatingUntil !== undefined && state.now >= rt.creatingUntil) {
      rt.creatingUntil = undefined
      rt.runningSince = state.now
      rt.nextProbeAt = state.now + pod.spec.probes.readiness.initialDelaySeconds
      rt.readinessSuccesses = 0
      rt.readinessFails = 0
      rt.livenessFails = 0
      if (state.knobs.chaosCrashLoop) rt.crashAt = state.now + CRASH_AFTER_SECONDS
      publishStatus(state, node, pod, (p) => {
        p.status.phase = 'Running'
        p.status.startedAt = state.now
        p.status.container.state = 'running'
        p.status.container.reason = undefined
        p.status.container.memMi = p.spec.requests.memMi
      })
      pushEvent(state, 'Normal', 'Started', pod.name, 'container started')
      continue
    }

    // backoff rung expired → rebuild
    if (
      pod.status.container.state === 'waiting'
      && pod.status.container.backoffUntil !== undefined
      && state.now >= pod.status.container.backoffUntil
    ) {
      publishStatus(state, node, pod, (p) => {
        p.status.container.backoffUntil = undefined
      })
      beginCreate(state, node, pod)
      continue
    }

    if (pod.status.container.state !== 'running') continue

    // chaos: the app exits on schedule
    if (rt.crashAt !== undefined && state.now >= rt.crashAt) {
      rt.crashAt = undefined
      containerExited(state, node, pod, rt, 1, 'Error')
      continue
    }

    // OOM: the kernel, not Kubernetes, pulls the breaker (exit 137)
    if (pod.status.container.memMi > pod.spec.limitMemMi) {
      containerExited(state, node, pod, rt, 137, 'OOMKilled')
      continue
    }

    // probes on their period
    if (state.now >= rt.nextProbeAt) {
      rt.nextProbeAt = state.now + pod.spec.probes.readiness.periodSeconds
      const flaky = state.knobs.chaosReadinessFlake
      const readinessOk = !flaky
      if (readinessOk) {
        rt.readinessFails = 0
        rt.readinessSuccesses += 1
        if (!pod.status.ready && rt.readinessSuccesses >= pod.spec.probes.readiness.successThreshold) {
          publishStatus(state, node, pod, (p) => {
            p.status.ready = true
          })
          pushEvent(state, 'Normal', 'Ready', pod.name, 'readiness probe passed — listed for traffic')
        }
      } else {
        rt.readinessSuccesses = 0
        rt.readinessFails += 1
        if (pod.status.ready && rt.readinessFails >= pod.spec.probes.readiness.failureThreshold) {
          publishStatus(state, node, pod, (p) => {
            p.status.ready = false
          })
          pushEvent(state, 'Warning', 'Unready', pod.name, 'readiness failing — CLOSED sign flipped')
        }
      }
      // liveness: passes unless a future chaos wires failure injection
    }
  }
}

/** Crash/OOM landing: restart counter, backoff ladder, status write. */
function containerExited(
  state: SimState,
  node: NodeSim,
  pod: PodObj,
  rt: LocalPodRuntime,
  exitCode: number,
  reason: 'Error' | 'OOMKilled',
): void {
  const cleanFor = rt.runningSince !== undefined ? state.now - rt.runningSince : 0
  const prev = pod.status.container.backoffSec
  const nextBackoff =
    cleanFor >= BACKOFF_RESET_AFTER || prev === 0
      ? BACKOFF_BASE
      : Math.min(prev * BACKOFF_FACTOR, BACKOFF_CAP)
  rt.runningSince = undefined

  publishStatus(state, node, pod, (p) => {
    p.status.ready = false
    p.status.container.state = 'waiting'
    // A6: the WAITING reason is CrashLoopBackOff for every restart loop; WHY
    // the last run ended lives in lastExitReason — which is why kubectl
    // flickers OOMKilled and then settles on CrashLoopBackOff.
    p.status.container.reason = 'CrashLoopBackOff'
    p.status.container.lastExitReason = reason
    p.status.container.restartCount += 1
    p.status.container.exitCode = exitCode
    p.status.container.backoffSec = nextBackoff
    p.status.container.backoffUntil = state.now + nextBackoff
  })
  pushEvent(
    state,
    'Warning',
    'BackOff',
    pod.name,
    `container exited (${exitCode}${reason === 'OOMKilled' ? ', OOMKilled' : ''}); restarting in ${nextBackoff}s`,
  )
}

/* ---------------------------------------------------------------------------
 * Graceful termination: preStop → SIGTERM → grace → SIGKILL → remove.
 * -------------------------------------------------------------------------*/

function beginTermination(state: SimState, node: NodeSim, pod: PodObj, rt: LocalPodRuntime): void {
  if (rt.sigtermAt !== undefined) return
  const t0 = pod.deletionTimestamp ?? state.now
  // B1: the grace countdown starts BEFORE preStop — the hook delays SIGTERM
  // but never extends the deadline. A preStop still running at expiry earns
  // exactly one 2-second extension. "A preStop sleep buys me extra time" is
  // the misconception; what it buys is a quieter SIGTERM.
  rt.preStopUntil = t0 + pod.spec.preStopSleepSec
  rt.sigtermAt = rt.preStopUntil
  const graceExpiry = t0 + pod.spec.tgps
  rt.killAt = rt.preStopUntil >= graceExpiry ? graceExpiry + 2 : graceExpiry
  publishStatus(state, node, pod, (p) => {
    p.status.container.state = 'terminating'
  })
  pushEvent(state, 'Normal', 'Killing', pod.name, `demolition notice posted (grace ${pod.spec.tgps}s)`)
}

function stepTermination(state: SimState, node: NodeSim, pod: PodObj, rt: LocalPodRuntime): void {
  if (rt.sigtermAt === undefined) {
    beginTermination(state, node, pod, rt)
    return
  }
  // A well-behaved app exits shortly after SIGTERM; SIGKILL is the backstop.
  const cleanExitAt = rt.sigtermAt + TERM_CLEAN_EXIT_SECONDS
  const done = state.now >= cleanExitAt || (rt.killAt !== undefined && state.now >= rt.killAt)
  if (!done) return

  node.kubelet.runtime.delete(pod.uid)
  submit(state, 'remove', clone(pod), `kubelet.${node.id}`)
  pushEvent(state, 'Normal', 'Removed', pod.name, 'site cleared; final paperwork filed')
}

/* ---------------------------------------------------------------------------
 * Every status change is an API write — the foreman queues at the desk too.
 * -------------------------------------------------------------------------*/

function publishStatus(
  state: SimState,
  node: NodeSim,
  pod: PodObj,
  mutate: (p: PodObj) => void,
): void {
  const next = clone(pod)
  mutate(next)
  submit(state, 'updateStatus', next, `kubelet.${node.id}`)
}

