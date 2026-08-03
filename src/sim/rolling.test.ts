/* M4 — rolling updates: the pacing IS the lesson.
 * Surge rounds up, unavailable rounds down (claims: deploy.rollingDefaults);
 * no old door closes until a new door is Ready; rollback reuses the old
 * ReplicaSet — never a third contract. */

import { describe, expect, it } from 'vitest'

import type { ReplicaSetObj, SimState } from '../core/types'
import { samples } from './samples'
import { DEMO_IMAGE_V1, DEMO_IMAGE_V2 } from './samples'
import { mkSim, step, stepUntil, pods } from './test-support'

function replicaSets(s: SimState): ReplicaSetObj[] {
  const out: ReplicaSetObj[] = []
  for (const o of s.etcd.objects.values()) if (o.kind === 'ReplicaSet') out.push(o)
  return out
}

function rsTotalSpec(s: SimState): number {
  return replicaSets(s).reduce((n, rs) => n + rs.spec.replicas, 0)
}

function readyNonTerminating(s: SimState): number {
  return pods(s).filter((p) => p.status.ready && !p.deletionTimestamp).length
}

function rolloutDone(s: SimState, image: string, n: number): boolean {
  const rss = replicaSets(s)
  const current = rss.find((rs) => rs.spec.template.image === image)
  if (!current) return false
  const oldTotal = rss.filter((rs) => rs !== current).reduce((t, rs) => t + rs.spec.replicas, 0)
  return (
    current.spec.replicas === n
    && current.status.ready === n
    && oldTotal === 0
    && pods(s).filter((p) => !p.deletionTimestamp).every((p) => p.spec.image === image)
  )
}

describe('rolling update pacing', () => {
  it('3 replicas @ default 25/25: surge 1, unavailable 0 — one over, never one short', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, '3 ready')

    sim.apply(samples.setImage(DEMO_IMAGE_V2))
    let maxTotalSpec = 0
    let minReady = Infinity
    let maxRsCount = 0
    stepUntil(
      sim,
      (s) => {
        maxTotalSpec = Math.max(maxTotalSpec, rsTotalSpec(s))
        minReady = Math.min(minReady, readyNonTerminating(s))
        maxRsCount = Math.max(maxRsCount, replicaSets(s).length)
        return rolloutDone(s, DEMO_IMAGE_V2, 3)
      },
      12000,
      'rollout complete',
    )
    // ceil(3*0.25)=1 surge → at most 4 contracts total; floor(3*0.25)=0
    // unavailable → the city never drops below 3 open doors.
    expect(maxTotalSpec).toBeLessThanOrEqual(4)
    expect(minReady).toBeGreaterThanOrEqual(3)
    expect(maxRsCount).toBe(2)

    // Deployment status is eventually consistent by design (the desk stamps it
    // on its next visit) — give the paperwork a bounded settle window.
    stepUntil(
      sim,
      (s) => {
        const dep = [...s.etcd.objects.values()].find((o) => o.kind === 'Deployment')!
        return dep.status.updated === 3 && dep.status.ready === 3
      },
      1200,
      'deployment status settles',
    )
  })

  it('6 replicas @ 25/25: surge 2 (ceil 1.5), unavailable 1 (floor 1.5)', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(6))
    stepUntil(sim, (s) => s.vitals.podsReady === 6, 6000, '6 ready')

    sim.apply(samples.setImage(DEMO_IMAGE_V2))
    let maxTotalSpec = 0
    let minReady = Infinity
    stepUntil(
      sim,
      (s) => {
        maxTotalSpec = Math.max(maxTotalSpec, rsTotalSpec(s))
        minReady = Math.min(minReady, readyNonTerminating(s))
        return rolloutDone(s, DEMO_IMAGE_V2, 6)
      },
      20000,
      'rollout complete',
    )
    expect(maxTotalSpec).toBeLessThanOrEqual(8)
    expect(minReady).toBeGreaterThanOrEqual(5)
  })

  it('readiness gates the wave: unready replacements block old scale-down', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, '3 ready')

    // New pods will be stamped with a first probe far in the future — they
    // start, but never pass readiness inside this test's window.
    sim.setKnob('initialDelaySec', 900)
    sim.apply(samples.setImage(DEMO_IMAGE_V2))
    step(sim, 3000) // 100 model-seconds — plenty for an ungated wave to finish

    const rss = replicaSets(sim.state)
    const oldRs = rss.find((rs) => rs.spec.template.image === DEMO_IMAGE_V1)!
    const newRs = rss.find((rs) => rs.spec.template.image === DEMO_IMAGE_V2)!
    // unavailable 0: not one old door may close; surge 1: exactly one new pad.
    expect(oldRs.spec.replicas).toBe(3)
    expect(newRs.spec.replicas).toBe(1)
    expect(readyNonTerminating(sim.state)).toBe(3)
  })

  it('both pacing knobs zero: clamped to surge 1 with a warning, still completes', () => {
    const sim = mkSim({ maxSurgePct: 0, maxUnavailablePct: 0 })
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, '3 ready')
    sim.apply(samples.setImage(DEMO_IMAGE_V2))
    stepUntil(sim, (s) => rolloutDone(s, DEMO_IMAGE_V2, 3), 15000, 'clamped rollout complete')
    expect(sim.state.events.some((e) => e.reason === 'InvalidPacing')).toBe(true)
  })

  it('rollback reuses the old ReplicaSet — never a third contract', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, '3 ready')
    sim.apply(samples.setImage(DEMO_IMAGE_V2))
    stepUntil(sim, (s) => rolloutDone(s, DEMO_IMAGE_V2, 3), 12000, 'v2 rollout')
    const v1Rs = replicaSets(sim.state).find((rs) => rs.spec.template.image === DEMO_IMAGE_V1)!

    sim.apply(samples.rollback())
    let maxRsCount = 0
    stepUntil(
      sim,
      (s) => {
        maxRsCount = Math.max(maxRsCount, replicaSets(s).length)
        return rolloutDone(s, DEMO_IMAGE_V1, 3)
      },
      12000,
      'rollback complete',
    )
    expect(maxRsCount).toBe(2)
    const v1After = replicaSets(sim.state).find((rs) => rs.spec.template.image === DEMO_IMAGE_V1)!
    expect(v1After.uid).toBe(v1Rs.uid) // the SAME old contract scaled back up
    const dep = [...sim.state.etcd.objects.values()].find((o) => o.kind === 'Deployment')!
    expect(dep.spec.template.image).toBe(DEMO_IMAGE_V1)
  })
})
