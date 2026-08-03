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
    if (!pod.spec.tolerations.some((t) => t.key === taint.key)) {
      return { node: nodeObj.name, ok: false, failed: 'TaintToleration' }
    }
  }
  const sim = state.nodes.find((n) => n.id === nodeObj.name)
  const cpuFree = nodeObj.status.allocatable.cpuM - (sim?.allocated.cpuM ?? 0)
  const memFree = nodeObj.status.allocatable.memMi - (sim?.allocated.memMi ?? 0)
  if (pod.spec.requests.cpuM > cpuFree || pod.spec.requests.memMi > memFree) {
    return { node: nodeObj.name, ok: false, failed: 'ResourcesFit' }
  }
  return { node: nodeObj.name, ok: true }
}

function scoreNode(state: SimState, pod: PodObj, nodeObj: NodeObj): ScoreEntry {
  const sim = state.nodes.find((n) => n.id === nodeObj.name)
  const cap = nodeObj.status.allocatable
  const usedCpu = (sim?.allocated.cpuM ?? 0) + pod.spec.requests.cpuM
  const usedMem = (sim?.allocated.memMi ?? 0) + pod.spec.requests.memMi

  // NodeResourcesLeastAllocated (shape, 0-100)
  const leastAllocated = Math.round(
    50 * (1 - usedCpu / cap.cpuM) + 50 * (1 - usedMem / cap.memMi),
  )
  // ImageLocality — the harbor pays off here.
  const imageLocality = sim?.imageCache.has(pod.spec.image) ? 100 : 0
  // Spread-lite: prefer nodes with fewer siblings of the same owner.
  let siblings = 0
  if (pod.ownerUid) {
    for (const o of state.etcd.objects.values()) {
      if (o.kind === 'Pod' && o.ownerUid === pod.ownerUid && o.spec.nodeName === nodeObj.name) {
        siblings += 1
      }
    }
  }
  const spread = Math.max(0, 100 - 25 * siblings)

  return {
    node: nodeObj.name,
    leastAllocated,
    imageLocality,
    spread,
    total: leastAllocated + imageLocality + spread,
  }
}
