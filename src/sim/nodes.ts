/* Kubetropolis sim — districts, foremen heartbeats, and the lifecycle desk.
 *
 * While a district has power, its foreman renews a Lease every 10 model
 * seconds (claims: kubelet.heartbeat). The node lifecycle desk checks every
 * 5s and flips Ready after 50s of silence (claims: node.monitor) — on
 * purpose doing NOTHING before that: networks blip more often than districts
 * die. Eviction (the 300s toleration countdown) arrives at M8.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { LeaseObj, NodeObj, SimState } from '../core/types'
import { submit } from './apiserver'
import { clone, pushEvent } from './objects'

const HEARTBEAT = CLAIM_VALUES.kubeletHeartbeat.statusUpdateSeconds
const MONITOR_PERIOD = CLAIM_VALUES.nodeMonitor.periodSeconds

/** Stage 7 companion: lease renewals from every powered district. */
export function stepLeaseRenewals(state: SimState): void {
  for (const node of state.nodes) {
    if (!node.powered) continue
    if (state.now < node.leaseRenewAt) continue
    node.leaseRenewAt = state.now + HEARTBEAT
    const lease = findLease(state, node.id)
    if (!lease) continue
    const next = clone(lease)
    next.spec.renewedAt = state.now
    submit(state, 'update', next, `kubelet.${node.id}`)
  }
}

/** Stage 5 periodic: the node lifecycle desk. */
export function stepNodeLifecycle(state: SimState): void {
  const ctl = state.controllers.nodelifecycle
  if (ctl.nextPeriodicAt !== undefined && state.now < ctl.nextPeriodicAt) return
  ctl.nextPeriodicAt = state.now + MONITOR_PERIOD
  ctl.reconciles += 1

  for (const obj of state.etcd.objects.values()) {
    if (obj.kind !== 'Node') continue
    const nodeObj = obj as NodeObj
    const lease = findLease(state, nodeObj.name)
    if (!lease) continue

    const silence = state.now - lease.spec.renewedAt
    const ready = nodeObj.status.conditions[0]
    const shouldBeReady = silence <= state.knobs.nodeGraceSec

    if (ready.status !== shouldBeReady) {
      const next = clone(nodeObj)
      next.status.conditions = [{ type: 'Ready', status: shouldBeReady, since: state.now }]
      submit(state, 'update', next, 'ctl.nodelifecycle')
      pushEvent(
        state,
        shouldBeReady ? 'Normal' : 'Warning',
        shouldBeReady ? 'NodeReady' : 'NodeNotReady',
        nodeObj.name,
        shouldBeReady
          ? 'heartbeats resumed'
          : `no heartbeat for ${Math.round(silence)}s (grace ${state.knobs.nodeGraceSec}s)`,
      )
    }
  }
}

/** Stage 9 chaos: cutting power to a district stops its foreman cold. */
export function applyNodeChaos(state: SimState): void {
  for (const node of state.nodes) {
    node.powered = state.knobs.chaosNodeFail !== node.id
  }
}

function findLease(state: SimState, nodeName: string): LeaseObj | undefined {
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'Lease' && o.name === nodeName) return o
  }
  return undefined
}
