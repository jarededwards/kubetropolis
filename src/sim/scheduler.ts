/* Kubetropolis sim — the Zoning Office.
 *
 * One pod per cycle: strike out districts that cannot hold the building
 * (filter), grade the survivors (score), and file the winner as ONE MORE
 * WRITE to the ledger saying where. Binding is not a construction order —
 * the foreman finds out the way everyone finds out everything: a courier.
 *
 * Honest scope (FIDELITY.md): three filter plugins and three score plugins
 * carrying their upstream names, presented as a subset of the scheduling
 * framework. Ties break on the lowest node id, deterministically.
 */

import type { FilterVerdict, NodeObj, PodObj, ScoreEntry, SimState } from '../core/types'
import { submit } from './apiserver'
import { clone, getPod, pushEvent, SCHED_BACKOFF_SECONDS } from './objects'

export function stepScheduler(state: SimState): void {
  const sched = state.sched

  // Assumed pods: forget an assumption once the bind is observed committed
  // (or the pod vanished while the bind was in flight).
  for (const [uid] of sched.assumed) {
    const pod = getPod(state, uid)
    if (!pod || pod.spec.nodeName) sched.assumed.delete(uid)
  }

  // Backoff retry: unschedulable pods rejoin the queue when due.
  if (sched.backoff.length > 0) {
    const still: typeof sched.backoff = []
    for (const b of sched.backoff) {
      if (b.until <= state.now) sched.queue.push(b.uid)
      else still.push(b)
    }
    sched.backoff = still
  }

  // Pop until we find a pod that still needs scheduling.
  let pod: PodObj | undefined
  while (sched.queue.length > 0) {
    const uid = sched.queue.shift()!
    const candidate = getPod(state, uid)
    if (candidate && !candidate.spec.nodeName && !candidate.deletionTimestamp) {
      pod = candidate
      break
    }
  }
  if (!pod) return

  const verdicts: FilterVerdict[] = []
  const survivors: NodeObj[] = []
  for (const nodeObj of nodesSorted(state)) {
    const verdict = filterNode(state, pod, nodeObj)
    verdicts.push(verdict)
    if (verdict.ok) survivors.push(nodeObj)
  }

  if (survivors.length === 0) {
    sched.cycle = { podUid: pod.uid, filter: verdicts, score: [] }
    sched.backoff.push({ uid: pod.uid, until: state.now + SCHED_BACKOFF_SECONDS })
    pushEvent(state, 'Warning', 'FailedScheduling', pod.name, 'no node satisfied the filters')
    return
  }

  const scores: ScoreEntry[] = survivors.map((n) => scoreNode(state, pod!, n))
  let best = scores[0]
  for (const s of scores) {
    if (s.total > best.total || (s.total === best.total && s.node < best.node)) best = s
  }

  sched.cycle = { podUid: pod.uid, filter: verdicts, score: scores, chosen: best.node }
  sched.scheduled += 1
  sched.assumed.set(pod.uid, best.node)

  // Bind = an API write. It enters admission next tick like everything else.
  const bound = clone(pod)
  bound.spec.nodeName = best.node
  bound.status.scheduledAt = state.now
  submit(state, 'update', bound, 'sched')
  pushEvent(state, 'Normal', 'Scheduled', pod.name, `assigned to ${best.node}`)
}

function nodesSorted(state: SimState): NodeObj[] {
  const out: NodeObj[] = []
  for (const o of state.etcd.objects.values()) if (o.kind === 'Node') out.push(o)
  out.sort((a, b) => (a.name < b.name ? -1 : 1))
  return out
}

function filterNode(state: SimState, pod: PodObj, nodeObj: NodeObj): FilterVerdict {
  if (nodeObj.spec.unschedulable) {
    return { node: nodeObj.name, ok: false, failed: 'Unschedulable' }
  }
  for (const taint of nodeObj.spec.taints) {
    // Tolerated only on key + effect (B3b): a NoExecute toleration does not
    // tolerate a NoSchedule taint. An effect-less toleration matches any.
    const tolerated = pod.spec.tolerations.some(
      (t) => t.key === taint.key && (t.effect === undefined || t.effect === taint.effect),
    )
    if (!tolerated) {
      return { node: nodeObj.name, ok: false, failed: 'TaintToleration' }
    }
  }
  const load = nodeLoad(state, nodeObj.name)
  const cpuFree = nodeObj.status.allocatable.cpuM - load.cpuM
  const memFree = nodeObj.status.allocatable.memMi - load.memMi
  if (pod.spec.requests.cpuM > cpuFree || pod.spec.requests.memMi > memFree) {
    return { node: nodeObj.name, ok: false, failed: 'ResourcesFit' }
  }
  return { node: nodeObj.name, ok: true }
}

/**
 * The zoning office's NodeInfo (B4): COMMITTED pods read from the vault — the
 * office's own frame, never the end-of-tick derived cache, which lags a bind
 * commit by one tick and briefly counts a fresh pod NOWHERE — plus the pods
 * this office has assumed pre-commit. Terminating pods still hold their
 * ground until removed, exactly like real NodeInfo.
 */
function nodeLoad(state: SimState, node: string): { cpuM: number; memMi: number } {
  let cpuM = 0
  let memMi = 0
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod' || o.spec.nodeName !== node) continue
    cpuM += o.spec.requests.cpuM
    memMi += o.spec.requests.memMi
  }
  for (const [uid, assumedNode] of state.sched.assumed) {
    if (assumedNode !== node) continue
    const pod = getPod(state, uid)
    if (pod && !pod.spec.nodeName) {
      cpuM += pod.spec.requests.cpuM
      memMi += pod.spec.requests.memMi
    }
  }
  return { cpuM, memMi }
}

function scoreNode(state: SimState, pod: PodObj, nodeObj: NodeObj): ScoreEntry {
  const cap = nodeObj.status.allocatable
  // B4: assumed pods count toward SCORING exactly as they do toward filtering
  // (the real scheduler's NodeInfo includes assumed pods) — otherwise a burst
  // of bare pods all grade node-a identical and pile onto it.
  const load = nodeLoad(state, nodeObj.name)
  const usedCpu = load.cpuM + pod.spec.requests.cpuM
  const usedMem = load.memMi + pod.spec.requests.memMi

  // NodeResourcesLeastAllocated (shape, 0-100)
  const leastAllocated = Math.round(
    50 * (1 - usedCpu / cap.cpuM) + 50 * (1 - usedMem / cap.memMi),
  )
  // ImageLocality — the harbor pays off here, but never outvotes spreading:
  // in the real default profile its weight is small next to topology spread.
  const nodeSim = state.nodes.find((n) => n.id === nodeObj.name)
  const imageLocality = nodeSim?.imageCache.has(pod.spec.image) ? 50 : 0
  // Spread-lite: prefer nodes with fewer siblings of the same owner —
  // counting both committed bindings and this office's own assumptions.
  let siblings = 0
  if (pod.ownerUid) {
    for (const o of state.etcd.objects.values()) {
      if (o.kind !== 'Pod' || o.ownerUid !== pod.ownerUid) continue
      const where = o.spec.nodeName ?? state.sched.assumed.get(o.uid)
      if (where === nodeObj.name) siblings += 1
    }
  }
  const spread = Math.max(0, 100 - 60 * siblings)

  return {
    node: nodeObj.name,
    leastAllocated,
    imageLocality,
    spread,
    total: leastAllocated + imageLocality + spread,
  }
}
