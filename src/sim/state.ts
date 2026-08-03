/* Kubetropolis sim — initial state.
 *
 * The city was already standing when you arrived: nodes and their leases are
 * bootstrapped directly into the vault as revisions 1..n, before any watcher
 * exists. Everything AFTER boot moves through the API like it must.
 */

import { DEFAULT_KNOBS } from '../core/types'
import type { ControllerId, ControllerState, Knobs, NodeSim, SimState } from '../core/types'
import { registerWatcher } from './apiserver'
import { mkLease, mkNode, NODE_CPU_M, NODE_MEM_MI } from './objects'

export const DEFAULT_SEED = 0x6b756265 // 'kube'

const NODE_NAMES = ['node-a', 'node-b', 'node-c', 'node-d', 'node-e', 'node-f']

function mkController(id: ControllerId, periodic?: number): ControllerState {
  return {
    id,
    workqueue: [],
    sentRev: 0,
    reconciles: 0,
    nextResyncAt: 3600, // long randomized resyncs are jittered on first use
    nextPeriodicAt: periodic,
    expect: new Map(),
  }
}

export function initState(seed: number, knobs: Knobs): SimState {
  const state: SimState = {
    tick: 0,
    now: 0,
    realT: 0,
    rngState: seed | 0 || 1,
    uidSeq: 0,
    knobs,
    scenario: null,
    etcd: {
      revision: 0,
      compactedRevision: 0,
      log: [],
      objects: new Map(),
      members: [
        { id: 0, healthy: true },
        { id: 1, healthy: true },
        { id: 2, healthy: true },
      ],
      leader: 0,
      fsyncMs: knobs.etcdFsyncMs,
      proposals: [],
      nextCompactionAt: 300,
    },
    api: { inflight: [], rejected: 0, watchers: [] },
    sched: { queue: [], backoff: [], scheduled: 0, assumed: new Map() },
    controllers: {
      deployment: mkController('deployment'),
      replicaset: mkController('replicaset'),
      endpointslice: mkController('endpointslice'),
      nodelifecycle: mkController('nodelifecycle', 0),
      hpa: mkController('hpa'),
      gc: mkController('gc'),
      lighthouse: mkController('lighthouse'),
    },
    nodes: [],
    harbor: { reachable: true, mbps: knobs.registryMBps },
    traffic: { reqPerSec: knobs.reqPerSec },
    operatorRunning: false,
    podOwners: new Map(),
    events: [],
    trace: null,
    vitals: {
      podsTotal: 0,
      podsRunning: 0,
      podsReady: 0,
      podsPending: 0,
      nodesReady: 0,
      etcdRevision: 0,
      watchMaxLagRev: 0,
      imagePullsActive: 0,
      restartsTotal: 0,
    },
  }

  // Bootstrap districts: direct vault writes, pre-watchers, revisions 1..2n.
  const count = Math.max(1, Math.min(NODE_NAMES.length, Math.round(knobs.nodeCount)))
  for (let i = 0; i < count; i++) {
    const name = NODE_NAMES[i]
    const nodeObj = mkNode(state, name)
    state.etcd.revision += 1
    nodeObj.resourceVersion = state.etcd.revision
    state.etcd.objects.set(nodeObj.uid, nodeObj)

    const lease = mkLease(state, name)
    state.etcd.revision += 1
    lease.resourceVersion = state.etcd.revision
    state.etcd.objects.set(lease.uid, lease)

    const nodeSim: NodeSim = {
      id: name,
      objUid: nodeObj.uid,
      powered: true,
      allocatable: { cpuM: NODE_CPU_M, memMi: NODE_MEM_MI },
      allocated: { cpuM: 0, memMi: 0 },
      leaseRenewAt: 0,
      imageCache: new Set(),
      pulls: [],
      kubelet: { sentRev: 0, syncQueue: [], nextSweepAt: 0, runtime: new Map() },
    }
    state.nodes.push(nodeSim)
  }

  // Subscribers — one desk, one road, one watch position each.
  registerWatcher(state, 'sched', ['Pod'])
  registerWatcher(state, 'ctl.deployment', ['Deployment', 'ReplicaSet'])
  registerWatcher(state, 'ctl.replicaset', ['ReplicaSet', 'Pod'])
  registerWatcher(state, 'ctl.nodelifecycle', ['Node', 'Lease'])
  for (const node of state.nodes) {
    registerWatcher(state, `kubelet.${node.id}`, ['Pod'])
  }

  return state
}
