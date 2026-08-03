/* Kubetropolis sim — derived stage: allocations, vitals, event trim. */

import type { PodObj, SimState } from '../core/types'
import { getSlice } from './objects'

export function derive(state: SimState): void {
  // Node allocations from committed bindings; usage from the traffic EMAs.
  for (const node of state.nodes) {
    node.allocated.cpuM = 0
    node.allocated.memMi = 0
    let used = 0
    for (const rt of node.kubelet.runtime.values()) used += rt.cpuUsedM ?? 0
    node.used.cpuM = used
  }
  let podsTotal = 0
  let podsRunning = 0
  let podsReady = 0
  let podsPending = 0
  let restarts = 0

  for (const obj of state.etcd.objects.values()) {
    if (obj.kind !== 'Pod') continue
    const pod = obj as PodObj
    podsTotal += 1
    if (pod.status.phase === 'Running') podsRunning += 1
    if (pod.status.phase === 'Pending') podsPending += 1
    if (pod.status.ready) podsReady += 1
    restarts += pod.status.container.restartCount
    if (pod.spec.nodeName) {
      const node = state.nodes.find((n) => n.id === pod.spec.nodeName)
      if (node) {
        node.allocated.cpuM += pod.spec.requests.cpuM
        node.allocated.memMi += pod.spec.requests.memMi
      }
    }
  }

  let nodesReady = 0
  for (const obj of state.etcd.objects.values()) {
    if (obj.kind === 'Node' && obj.status.conditions[0]?.status === 'True') nodesReady += 1
  }

  let maxLag = 0
  for (const w of state.api.watchers) {
    maxLag = Math.max(maxLag, state.etcd.revision - w.sentRev)
  }

  let pulls = 0
  let cpuUsedM = 0
  for (const node of state.nodes) {
    pulls += node.pulls.length
    cpuUsedM += node.used.cpuM
  }

  const slice = getSlice(state)
  const readyEndpoints = slice
    ? slice.spec.endpoints.reduce((n, e) => n + (e.conditions.ready ? 1 : 0), 0)
    : 0

  let crdRegistered = false
  for (const obj of state.etcd.objects.values()) {
    if (obj.kind === 'CustomResourceDefinition') {
      crdRegistered = true
      break
    }
  }

  state.vitals = {
    podsTotal,
    podsRunning,
    podsReady,
    podsPending,
    nodesReady,
    etcdRevision: state.etcd.revision,
    watchMaxLagRev: maxLag,
    imagePullsActive: pulls,
    restartsTotal: restarts,
    readyEndpoints,
    sliceGeneration: slice?.generation ?? 0,
    reqServedTotal: state.traffic.served,
    reqMisroutedTotal: state.traffic.misrouted,
    reqRefusedTotal: state.traffic.refused,
    cpuUsedM: Math.round(cpuUsedM),
    crdRegistered,
  }
}
