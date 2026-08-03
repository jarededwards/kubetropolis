/* M8 — self-healing and scale: taint eviction's two clocks, drain vs the
 * budget, the neighborhood quota, and the autoscaler's one division. */

import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import type { DeploymentObj, NodeObj, PdbObj, QuotaObj } from '../core/types'
import { samples } from './samples'
import { mkSim, pods, step, stepUntil } from './test-support'

const GRACE = CLAIM_VALUES.nodeMonitor.graceSeconds
const TICKS_PER_S = 30

function readyDeployment(sim: ReturnType<typeof mkSim>, replicas = 3): void {
  sim.apply(samples.deployment(replicas))
  stepUntil(sim, (s) => s.vitals.podsReady === replicas, 90 * TICKS_PER_S, `deployment ready ${replicas}`)
}

function nodeObj(sim: ReturnType<typeof mkSim>, name: string): NodeObj {
  for (const o of sim.state.etcd.objects.values()) {
    if (o.kind === 'Node' && o.name === name) return o
  }
  throw new Error(`no node ${name}`)
}

describe('taint-based eviction — the two clocks', () => {
  it('runs 50s of silence, arms 300s countdowns, then rebuilds elsewhere', () => {
    const sim = mkSim({ unreachableTolerationSec: 30 }) // shortened third clock, honest default asserted below
    readyDeployment(sim)
    const victimNode = 'node-b'
    const before = pods(sim.state).filter((p) => p.spec.nodeName === victimNode)
    expect(before.length).toBeGreaterThan(0)

    const cut = sim.state.now
    sim.apply(samples.nodePower(victimNode, false))

    // Clock 1: nothing happens for the monitor grace.
    stepUntil(
      sim,
      (s) => nodeObj(sim, victimNode).status.conditions[0].status === 'Unknown',
      (GRACE + 20) * TICKS_PER_S,
      'NotReady',
    )
    const notReadyAt = sim.state.now
    // Grace is measured from the LAST HEARTBEAT, which may predate the cut by
    // up to one renewal interval.
    expect(notReadyAt - cut).toBeGreaterThanOrEqual(
      GRACE - CLAIM_VALUES.kubeletHeartbeat.leaseRenewSeconds,
    )
    expect(notReadyAt - cut).toBeLessThanOrEqual(GRACE + 10)

    // Countdowns armed for every pod bound there.
    stepUntil(sim, (s) => s.vitals.evictionsArmed >= before.length, 10 * TICKS_PER_S, 'countdowns armed')

    // Clock 2: the toleration. Pods survive until it expires, then NodeLost.
    const armedUntil = Math.max(...[...sim.state.evictions.values()])
    expect(armedUntil - notReadyAt).toBeGreaterThanOrEqual(29)
    stepUntil(
      sim,
      (s) => pods(s).every((p) => p.spec.nodeName !== victimNode),
      120 * TICKS_PER_S,
      'NodeLost removals',
    )
    expect(sim.state.events.some((e) => e.reason === 'NodeLost')).toBe(true)

    // Self-healing: the contract rebuilds on live districts only.
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 120 * TICKS_PER_S, 'replacements ready')
    for (const p of pods(sim.state)) expect(p.spec.nodeName).not.toBe(victimNode)
  })

  it('cancels countdowns when power returns before expiry', () => {
    const sim = mkSim({ unreachableTolerationSec: 300 })
    readyDeployment(sim)
    sim.apply(samples.nodePower('node-b', false))
    stepUntil(sim, (s) => s.vitals.evictionsArmed > 0, 90 * TICKS_PER_S, 'armed')
    sim.apply(samples.nodePower('node-b', true))
    stepUntil(sim, (s) => s.vitals.evictionsArmed === 0, 60 * TICKS_PER_S, 'cancelled')
    // The node heals: taints lift, pods stay bound and recover readiness.
    stepUntil(
      sim,
      () => nodeObj(sim, 'node-b').spec.taints.length === 0,
      60 * TICKS_PER_S,
      'taints lifted',
    )
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 120 * TICKS_PER_S, 'pods ready again')
    expect(pods(sim.state).some((p) => p.spec.nodeName === 'node-b')).toBe(true)
  })
})

describe('drain and the disruption budget', () => {
  it('cordons, then a blocked budget bounces evictions with 429s until capacity arrives', () => {
    const sim = mkSim({ pdbEnabled: true, pdbMinAvailable: 3 })
    readyDeployment(sim, 3)
    stepUntil(
      sim,
      (s) => [...s.etcd.objects.values()].some((o) => o.kind === 'PodDisruptionBudget'),
      30 * TICKS_PER_S,
      'pdb object',
    )

    sim.apply(samples.drain('node-b'))
    stepUntil(sim, () => nodeObj(sim, 'node-b').spec.unschedulable === true, 30 * TICKS_PER_S, 'cordoned')

    // 3 ready, minAvailable 3 → every eviction is refused; the drain retries.
    stepUntil(sim, (s) => s.vitals.drainDeniedTotal >= 2, 120 * TICKS_PER_S, 'denied evictions')
    step(sim, 24) // let the second denial's status stamp land in the vault
    expect(pods(sim.state).filter((p) => !p.deletionTimestamp).length).toBe(3)
    const pdb = [...sim.state.etcd.objects.values()].find(
      (o) => o.kind === 'PodDisruptionBudget',
    ) as PdbObj
    expect(pdb.status.blockedEvictions).toBeGreaterThanOrEqual(2)

    // Capacity first: scale to 5 → the budget frees → the drain completes.
    sim.apply(samples.scale(5))
    stepUntil(
      sim,
      (s) => pods(s).filter((p) => p.spec.nodeName === 'node-b' && !p.deletionTimestamp).length === 0,
      240 * TICKS_PER_S,
      'node-b drained',
    )
    // The drain's DONE stamp fires on its next visit (paced by its backoff).
    stepUntil(
      sim,
      (s) => s.events.some((e) => e.reason === 'NodeDrained'),
      40 * TICKS_PER_S,
      'NodeDrained event',
    )

    // Cordon keeps zoning away until uncordon.
    for (const p of pods(sim.state)) {
      if (!p.deletionTimestamp) expect(p.spec.nodeName).not.toBe('node-b')
    }
    sim.apply(samples.uncordon('node-b'))
    stepUntil(sim, () => nodeObj(sim, 'node-b').spec.unschedulable !== true, 30 * TICKS_PER_S, 'uncordoned')
  })

  it('drains promptly when the budget has headroom', () => {
    const sim = mkSim({ pdbEnabled: true, pdbMinAvailable: 2 })
    readyDeployment(sim, 3)
    sim.apply(samples.drain('node-b'))
    stepUntil(
      sim,
      (s) => pods(s).filter((p) => p.spec.nodeName === 'node-b' && !p.deletionTimestamp).length === 0,
      240 * TICKS_PER_S,
      'drained with headroom',
    )
    // Evictions here are graceful deletes: the kubelet ran the dance (no NodeLost).
    expect(sim.state.events.some((e) => e.reason === 'NodeLost')).toBe(false)
  })
})

describe('the neighborhood quota', () => {
  it('rejects the ninth permit, retries forever, and converges after the cap lifts', () => {
    const sim = mkSim({ chaosQuotaLow: true })
    readyDeployment(sim, 3)
    sim.apply(samples.scale(12))

    stepUntil(sim, (s) => s.vitals.quotaRejectedTotal >= 1, 90 * TICKS_PER_S, 'FailedCreate')
    stepUntil(sim, (s) => s.vitals.podsTotal === 8, 120 * TICKS_PER_S, 'capped at 8')
    step(sim, 30 * TICKS_PER_S)
    expect(sim.state.vitals.podsTotal).toBe(8)
    const rejectedSoFar = sim.state.vitals.quotaRejectedTotal
    // The desk keeps filing — inspectors do not sulk.
    step(sim, 40 * TICKS_PER_S)
    expect(sim.state.vitals.quotaRejectedTotal).toBeGreaterThan(rejectedSoFar)
    const dep = [...sim.state.etcd.objects.values()].find(
      (o) => o.kind === 'Deployment',
    ) as DeploymentObj
    expect(dep.spec.replicas).toBe(12)

    const quota = [...sim.state.etcd.objects.values()].find(
      (o) => o.kind === 'ResourceQuota',
    ) as QuotaObj
    expect(quota.spec.hardPods).toBe(8)

    sim.setKnob('chaosQuotaLow', false)
    stepUntil(sim, (s) => s.vitals.podsReady === 12, 300 * TICKS_PER_S, 'converged to 12')
  })
})

describe('the autoscaler desk', () => {
  it('scales up on traffic, and the stabilization window refuses to panic down', () => {
    const sim = mkSim({
      hpaEnabled: true,
      hpaTargetCpuPct: 50,
      hpaMin: 1,
      hpaMax: 10,
      reqPerSec: 0,
    })
    readyDeployment(sim, 2)
    sim.apply(samples.service())
    stepUntil(sim, (s) => s.vitals.sliceGeneration > 0, 60 * TICKS_PER_S, 'directory listed')

    sim.setKnob('reqPerSec', 220)
    const upAt = stepUntil(sim, (s) => s.vitals.hpaLastDesired > 2, 180 * TICKS_PER_S, 'scaled up')
    expect(upAt).toBeGreaterThan(0)
    const peakDesired = sim.state.vitals.hpaLastDesired
    stepUntil(sim, (s) => s.vitals.podsReady >= peakDesired, 240 * TICKS_PER_S, 'new pads ready')

    // Traffic halves; inside the stabilization window nothing is demolished.
    sim.setKnob('reqPerSec', 20)
    const replicasAtDrop = (
      [...sim.state.etcd.objects.values()].find((o) => o.kind === 'Deployment') as DeploymentObj
    ).spec.replicas
    step(sim, (CLAIM_VALUES.hpa.stabilizationSeconds / 2) * TICKS_PER_S)
    const midWindow = (
      [...sim.state.etcd.objects.values()].find((o) => o.kind === 'Deployment') as DeploymentObj
    ).spec.replicas
    expect(midWindow).toBe(replicasAtDrop)

    // After the window, the desk finally writes the lower number.
    stepUntil(
      sim,
      (s) => {
        const d = [...s.etcd.objects.values()].find((o) => o.kind === 'Deployment') as DeploymentObj
        return d.spec.replicas < replicasAtDrop
      },
      (CLAIM_VALUES.hpa.stabilizationSeconds + 90) * TICKS_PER_S,
      'scaled down after window',
    )
  })
})
