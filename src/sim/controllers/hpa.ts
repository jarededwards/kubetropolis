/* Kubetropolis sim — the autoscaler desk (M8).
 *
 * One division, every fifteen model seconds (claims: hpa.sync):
 * desired = ceil(current × utilization/target), a ±10% deadband inside which
 * the pen never moves (claims: hpa.formula), and a scale-down stabilization
 * window — the desk acts on the HIGHEST recommendation of the last five model
 * minutes, so brief dips never demolish (claims: hpa.stabilization).
 *
 * Metrics honesty: utilization is the model's synthesized per-pod CPU EMA
 * from live request traffic — there is no metrics-server in this city
 * (FIDELITY.md).
 */

import { CLAIM_VALUES } from '../../core/claims'
import type { DeploymentObj, PodObj, SimState } from '../../core/types'
import { submit } from '../apiserver'
import { clone, getHpa, pushEvent } from '../objects'

export function stepHpa(state: SimState): void {
  const hpa = getHpa(state)
  if (!hpa) return
  const ctl = state.controllers.hpa
  if (ctl.nextPeriodicAt !== undefined && state.now < ctl.nextPeriodicAt) return
  ctl.nextPeriodicAt = state.now + CLAIM_VALUES.hpa.syncSeconds
  ctl.reconciles += 1

  let dep: DeploymentObj | undefined
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'Deployment' && o.name === hpa.spec.targetDeployment) dep = o
  }
  if (!dep) return

  // Mean utilization across READY pods of the target's app label.
  let usedM = 0
  let requestedM = 0
  let sampled = 0
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod') continue
    const pod = o as PodObj
    if (pod.labels.app !== hpa.spec.targetDeployment || !pod.status.ready) continue
    const node = state.nodes.find((n) => n.id === pod.spec.nodeName)
    usedM += node?.kubelet.runtime.get(pod.uid)?.cpuUsedM ?? 0
    requestedM += pod.spec.requests.cpuM
    sampled += 1
  }
  if (sampled === 0 || requestedM === 0) return

  const utilizationPct = (usedM / requestedM) * 100
  const ratio = utilizationPct / hpa.spec.targetCpuPct
  const current = dep.spec.replicas
  const deadband = CLAIM_VALUES.hpa.tolerancePct / 100
  let desired = Math.abs(ratio - 1) <= deadband ? current : Math.ceil(current * ratio)
  desired = Math.max(hpa.spec.min, Math.min(hpa.spec.max, desired))

  // Recommendations ring: scale-down acts on the window's HIGHEST number.
  const windowStart = state.now - CLAIM_VALUES.hpa.stabilizationSeconds
  const recs = hpa.status.recommendations.filter((r) => r.at >= windowStart)
  recs.push({ at: state.now, desired })
  let effective = desired
  if (desired < current) {
    for (const r of recs) effective = Math.max(effective, Math.min(r.desired, hpa.spec.max))
    effective = Math.min(effective, current)
  }

  const nextStatus = clone(hpa)
  nextStatus.status = {
    currentUtilizationPct: Math.round(utilizationPct),
    desired: effective,
    recommendations: recs,
    lastScaleAt: effective !== current ? state.now : hpa.status.lastScaleAt,
  }
  submit(state, 'updateStatus', nextStatus, 'ctl.hpa')

  state.counters.hpaLastDesired = effective
  if (effective !== current) {
    const nextDep = clone(dep)
    nextDep.spec.replicas = effective
    // The desk edits exactly one number, through the permit hall.
    submit(state, 'update', nextDep, 'ctl.hpa')
    pushEvent(
      state,
      'Normal',
      effective > current ? 'ScaledUp' : 'ScaledDown',
      dep.name,
      `utilization ${Math.round(utilizationPct)}% of ${hpa.spec.targetCpuPct}% target → desired ${effective}`,
    )
  }
}
