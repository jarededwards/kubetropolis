/* Kubetropolis sim — stage 8, the data plane: citizens.
 *
 * Requests arrive DETERMINISTICALLY (reqPerSec × dt accumulates and dispatches
 * on whole requests — a seeded interleave, deliberately not Poisson-random).
 * The junction assigns each request a door by round-robin over the directory's
 * ready listings; whether the door actually serves is checked against the
 * street's truth — a door that stopped serving while some view still listed it
 * is a MISROUTE, counted, never hand-waved. During a preStop sleep the app is
 * still serving: that window is the entire reason the hook exists.
 *
 * Served requests synthesize CPU: each request costs reqCpuCostM
 * millicore-seconds, so a pod serving R req/s sustains R × cost millicores —
 * the substation needles move with traffic, and the HPA (M8) will read this.
 */

import type { EndpointEntry, PodObj, SimState } from '../core/types'
import { getPod, getSlice } from './objects'

/** EMA time constant for the synthesized usage needle, model seconds. */
const CPU_EMA_TAU = 2
/** one visual packet represents this many requests (pure presentation) */
const FLOW_SAMPLE = 4
const MISROUTE_RED = 0xff4d5e

/** chaosReadinessFlake: deterministic 40 s bad windows (shared with kubelet). */
export function flakeBadWindow(state: SimState): boolean {
  return state.knobs.chaosReadinessFlake && Math.floor(state.now / 40) % 2 === 1
}

/** Is this door ACTUALLY serving, right now, on the street? */
export function servingTruth(state: SimState, pod: PodObj | undefined): boolean {
  if (!pod) return false
  const cs = pod.status.container.state
  if (pod.deletionTimestamp !== undefined) {
    // A row changed in the vault; the app has not been told anything. It
    // serves until SIGTERM actually lands — through the courier delay AND
    // through any preStop window. That is the entire mechanism of the fix.
    if (cs !== 'running' && cs !== 'terminating') return false
    const node = state.nodes.find((n) => n.id === pod.spec.nodeName)
    const rt = node?.kubelet.runtime.get(pod.uid)
    if (!rt) return false // the site is cleared
    if (rt.sigtermAt === undefined) return true // termination not begun yet
    return state.now < rt.sigtermAt
  }
  if (cs !== 'running') return false
  // A flaking app fails its users exactly when it fails its probes.
  return !flakeBadWindow(state)
}

export function stepTraffic(state: SimState, dt: number): void {
  const traffic = state.traffic

  // Dispatch this tick's arrivals.
  const servedByPod = new Map<string, number>()
  traffic.accumulator += traffic.reqPerSec * dt
  let arrivals = Math.floor(traffic.accumulator)
  traffic.accumulator -= arrivals

  const slice = getSlice(state)
  const directory: EndpointEntry[] = slice
    ? slice.spec.endpoints.filter((e) => e.conditions.ready)
    : []

  let servedTotal = 0
  const servedByNode = new Map<string, number>()
  let misroutes = 0
  const misrouteNodes: string[] = []

  if (arrivals > 0 && !slice) {
    // Nothing to dial: the shops have no number yet (honest idle, not a failure).
    traffic.idleNoService += arrivals
    arrivals = 0
  }
  if (arrivals > 0 && directory.length === 0) {
    // The board lists no open doors — every caller is turned away at the
    // junction itself. This is the readiness lesson working as designed.
    traffic.misrouted += arrivals
    misroutes += arrivals
    arrivals = 0
  }
  for (let i = 0; i < arrivals; i++) {
    const entry = directory[traffic.rrCursor % directory.length]
    traffic.rrCursor = (traffic.rrCursor + 1) % 1_000_000
    const pod = getPod(state, entry.podUid)
    if (servingTruth(state, pod)) {
      traffic.served += 1
      servedTotal += 1
      servedByPod.set(entry.podUid, (servedByPod.get(entry.podUid) ?? 0) + 1)
      servedByNode.set(entry.nodeName, (servedByNode.get(entry.nodeName) ?? 0) + 1)
    } else {
      // The signage still lists a closed door: the caller reached rubble.
      traffic.misrouted += 1
      misroutes += 1
      misrouteNodes.push(entry.nodeName)
    }
  }

  // Synthesized CPU: EMA toward this tick's instantaneous per-pod rate.
  const alpha = Math.min(1, dt / CPU_EMA_TAU)
  for (const node of state.nodes) {
    for (const rt of node.kubelet.runtime.values()) {
      const served = servedByPod.get(rt.podUid) ?? 0
      const inst = dt > 0 ? (served / dt) * state.knobs.reqCpuCostM : 0
      const prev = rt.cpuUsedM ?? 0
      rt.cpuUsedM = prev + (inst - prev) * alpha
    }
  }

  // Visual sampling: one packet ≈ FLOW_SAMPLE requests (presentation only).
  if (servedTotal + misroutes > 0) {
    state.flowOutbox.push({
      route: 'request.in',
      kind: 'request',
      count: Math.max(1, Math.ceil((servedTotal + misroutes) / FLOW_SAMPLE)),
    })
  }
  for (const [nodeId, count] of servedByNode) {
    const letter = nodeId.slice('node-'.length)
    if (letter === 'a' || letter === 'b' || letter === 'c') {
      state.flowOutbox.push({
        route: `request.${letter}`,
        kind: 'request',
        count: Math.max(1, Math.ceil(count / FLOW_SAMPLE)),
      })
    }
  }
  for (const nodeId of misrouteNodes.slice(0, 3)) {
    const letter = nodeId.slice('node-'.length)
    if (letter === 'a' || letter === 'b' || letter === 'c') {
      // the red flick: a caller turned away at a door the signage still listed
      state.flowOutbox.push({ route: `request.${letter}`, kind: 'request', count: 1, color: MISROUTE_RED })
    }
  }
}
