/* Kubetropolis sim — districts, foremen heartbeats, and the lifecycle desk.
 *
 * While a district has power, its foreman renews a Lease every 10 model
 * seconds (claims: kubelet.heartbeat — a quarter of the 40s lease duration;
 * the Node .status heartbeat is a separate, five-minute affair). The node
 * lifecycle desk checks every 5s and, after 50s of silence (claims:
 * node.monitor), marks the node Ready=Unknown — silence means UNKNOWN, not
 * dead — stamps the unreachable taints, and marks the node's pods unready
 * (the MarkPodsNotReady analog) so the directory stops listing them.
 * Eviction (the 300s toleration countdown) lives in lifecycle.ts.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { LeaseObj, NodeObj, PodObj, SimState, TaintEffect } from '../core/types'
import { submit } from './apiserver'
import { clone, pushEvent } from './objects'

const LEASE_RENEW = CLAIM_VALUES.kubeletHeartbeat.leaseRenewSeconds
const MONITOR_PERIOD = CLAIM_VALUES.nodeMonitor.periodSeconds

const UNREACHABLE = 'node.kubernetes.io/unreachable'
const UNREACHABLE_TAINTS: { key: string; effect: TaintEffect }[] = [
  { key: UNREACHABLE, effect: 'NoSchedule' },
  { key: UNREACHABLE, effect: 'NoExecute' },
]

/** Stage 7 companion: lease renewals from every powered district. */
export function stepLeaseRenewals(state: SimState): void {
  for (const node of state.nodes) {
    if (!node.powered) continue
    if (state.now < node.leaseRenewAt) continue
    node.leaseRenewAt = state.now + LEASE_RENEW
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
    // Heartbeat loss ⇒ Ready=UNKNOWN (the desk cannot tell dead from
    // partitioned), which stamps the `unreachable` taints. A reachable-but-
    // unhealthy kubelet would be Ready=False with `not-ready` taints — that
    // path awaits a kubelet-health chaos knob (FIDELITY.md).
    const desired: NodeObj['status']['conditions'][0]['status'] =
      silence <= state.knobs.nodeGraceSec ? 'True' : 'Unknown'

    if (ready.status !== desired) {
      const next = clone(nodeObj)
      next.status.conditions = [{ type: 'Ready', status: desired, since: state.now }]
      submit(state, 'updateStatus', next, 'ctl.nodelifecycle')

      // B3: the taint pass rides the same transition — condition via status,
      // taints via spec, both through the permit hall.
      const tainted = clone(nodeObj)
      tainted.spec.taints = desired === 'True'
        ? tainted.spec.taints.filter((t) => t.key !== UNREACHABLE)
        : dedupeTaints([...tainted.spec.taints, ...UNREACHABLE_TAINTS])
      submit(state, 'update', tainted, 'ctl.nodelifecycle')

      // B10: MarkPodsNotReady — a district that went silent stops being
      // listed. The kubelet's probes restore readiness when power returns.
      if (desired !== 'True') {
        for (const o of state.etcd.objects.values()) {
          if (o.kind !== 'Pod') continue
          const pod = o as PodObj
          if (pod.spec.nodeName !== nodeObj.name || !pod.status.ready) continue
          const unready = clone(pod)
          unready.status.ready = false
          submit(state, 'updateStatus', unready, 'ctl.nodelifecycle')
        }
      }

      pushEvent(
        state,
        desired === 'True' ? 'Normal' : 'Warning',
        desired === 'True' ? 'NodeReady' : 'NodeNotReady',
        nodeObj.name,
        desired === 'True'
          ? 'heartbeats resumed'
          : `no heartbeat for ${Math.round(silence)}s (grace ${state.knobs.nodeGraceSec}s) — Ready=Unknown, tainted unreachable`,
      )
    }
  }
}

function dedupeTaints(
  taints: { key: string; effect: TaintEffect }[],
): { key: string; effect: TaintEffect }[] {
  const seen = new Set<string>()
  const out: { key: string; effect: TaintEffect }[] = []
  for (const t of taints) {
    const id = `${t.key}|${t.effect}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(t)
  }
  return out
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
