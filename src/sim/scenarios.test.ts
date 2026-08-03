/* M4 — the scenario engine: knob snapshot/restore, deterministic beat
 * timelines, conditional setup, and every oomkill decision branch. */

import { describe, expect, it } from 'vitest'

import type { SimState } from '../core/types'
import { DEMO_IMAGE_V1, DEMO_IMAGE_V2 } from './samples'
import { mkSim, pods, step, stepUntil } from './test-support'

function deployments(s: SimState) {
  return [...s.etcd.objects.values()].filter((o) => o.kind === 'Deployment')
}

describe('scenario engine', () => {
  it('applies knobs on start and restores them (with mirrors) on end', () => {
    const sim = mkSim()
    const mbpsBefore = sim.state.knobs.registryMBps
    // Entry knobs apply immediately (crashloop) …
    sim.startScenario('crashloop')
    step(sim, 5)
    expect(sim.state.knobs.chaosCrashLoop).toBe(true)
    sim.endScenario()
    expect(sim.state.knobs.chaosCrashLoop).toBe(false)
    // … and scheduled knobsAt apply on their clock (the storm's fog at 20s),
    // syncing mirrors both ways.
    sim.startScenario('image-pull-storm')
    stepUntil(sim, (s) => s.knobs.chaosRegistryOutage, 1200, 'fog rolls in')
    expect(sim.state.harbor.reachable).toBe(false)
    sim.endScenario()
    expect(sim.state.knobs.chaosRegistryOutage).toBe(false)
    expect(sim.state.harbor.reachable).toBe(true)
    expect(sim.state.knobs.registryMBps).toBe(mbpsBefore)
    expect(sim.state.scenarioRun).toBeNull()
    expect(sim.state.scenario).toBeNull()
  })

  it('setup creates the demo deployment only when missing', () => {
    const fresh = mkSim()
    fresh.startScenario('steady-state')
    stepUntil(fresh, (s) => deployments(s).length === 1, 3000, 'deployment created')

    const seeded = mkSim()
    seeded.apply({ kind: 'ApplyDeployment', name: 'shopfront', image: DEMO_IMAGE_V1, replicas: 3 })
    stepUntil(seeded, (s) => deployments(s).length === 1, 3000, 'pre-seeded')
    seeded.startScenario('steady-state')
    step(seeded, 600)
    expect(deployments(seeded.state).length).toBe(1)
  })

  it('beat timeline is deterministic across two fresh runs', () => {
    const record = (): Array<[number, string]> => {
      const sim = mkSim()
      sim.startScenario('crashloop')
      const seen: Array<[number, string]> = []
      let last = ''
      for (let i = 0; i < 5000; i++) {
        sim.update(1 / 30)
        const b = sim.state.scenarioRun?.beat
        if (b && b.title !== last) {
          last = b.title
          seen.push([b.at, b.title])
        }
      }
      return seen
    }
    const a = record()
    const b = record()
    expect(a.length).toBeGreaterThanOrEqual(2)
    expect(a).toEqual(b)
  })

  it('a timed scenario ends itself and restores the world', () => {
    const sim = mkSim()
    sim.startScenario('steady-state') // duration 90
    stepUntil(sim, (s) => s.scenarioRun === null, 4000, 'auto-end')
    expect(sim.state.scenario).toBeNull()
  })
})

describe('oomkill decisions', () => {
  function runToDecision() {
    const sim = mkSim()
    sim.startScenario('oomkill')
    stepUntil(sim, (s) => s.scenarioRun?.decisionAvailable === true, 8000, 'decision revealed')
    return sim
  }

  it('reveals after the first OOM has already happened', () => {
    const sim = runToDecision()
    expect(sim.state.events.some((e) => e.reason === 'BackOff' && e.message.includes('OOMKilled'))).toBe(true)
  })

  it('rollout-undo: the v1 contract scales back up', () => {
    const sim = runToDecision()
    sim.scenarioChoice('rollout-undo')
    stepUntil(
      sim,
      (s) => {
        const dep = deployments(s)[0]
        return dep?.spec.template.image === DEMO_IMAGE_V1
          && pods(s).filter((p) => !p.deletionTimestamp && p.spec.image === DEMO_IMAGE_V1 && p.status.ready).length === 3
      },
      20000,
      'v1 restored',
    )
    expect(sim.state.scenarioRun?.consequence).toContain('old contract')
  })

  it('raise-limit: a template change — the wave rebuilds with taller towers', () => {
    const sim = runToDecision()
    sim.scenarioChoice('raise-limit')
    stepUntil(
      sim,
      (s) => deployments(s)[0]?.spec.template.limitMemMi === 1024,
      3000,
      'limit patched',
    )
    // The new template means a THIRD contract is legitimate here.
    stepUntil(
      sim,
      (s) => pods(s).some((p) => !p.deletionTimestamp && p.spec.limitMemMi === 1024),
      20000,
      'taller towers rise',
    )
  })

  it('add-replicas: five buildings leak in parallel — not a fix', () => {
    const sim = runToDecision()
    sim.scenarioChoice('add-replicas')
    stepUntil(sim, (s) => deployments(s)[0]?.spec.replicas === 5, 3000, 'scaled to 5')
    const restartsAt = sim.state.vitals.restartsTotal
    stepUntil(sim, (s) => s.vitals.restartsTotal > restartsAt, 30000, 'the blackouts continue')
  })
})

describe('image-pull-storm', () => {
  it('v1 city keeps serving while the v2 wave stalls at the quay', () => {
    const sim = mkSim()
    sim.startScenario('image-pull-storm')
    stepUntil(
      sim,
      (s) => pods(s).some((p) => p.spec.image === DEMO_IMAGE_V2 && p.status.container.reason === 'ImagePullBackOff'),
      20000,
      'v2 stalls in ImagePullBackOff',
    )
    const v1Ready = pods(sim.state).filter(
      (p) => p.spec.image === DEMO_IMAGE_V1 && p.status.ready && !p.deletionTimestamp,
    ).length
    expect(v1Ready).toBe(3) // not one open door closed
  })
})

describe('rollout-surge', () => {
  it('runs each pacing contract as a real spec write and a real rollout', () => {
    const sim = mkSim()
    sim.startScenario('rollout-surge')

    // Phase 1: default contract carries the v2 renovation.
    stepUntil(
      sim,
      (s) => deployments(s)[0]?.spec.template.image === DEMO_IMAGE_V2,
      1200,
      'v2 filed under the default contract',
    )
    const d1 = deployments(sim.state)[0]!
    expect(d1.spec.maxSurgePct).toBeGreaterThan(0)

    // Phase 2 (t≈70): the contract itself changes via the API, then v1 returns.
    stepUntil(
      sim,
      (s) => {
        const d = deployments(s)[0]
        return d?.spec.maxSurgePct === 0 && d?.spec.maxUnavailablePct === 50
      },
      3000,
      'surge-zero contract filed',
    )
    stepUntil(
      sim,
      (s) => deployments(s)[0]?.spec.template.image === DEMO_IMAGE_V1,
      3000,
      'renovation runs back to v1',
    )
    // The surge-zero wave really walks: v1 pods appear while the contract holds.
    stepUntil(
      sim,
      (s) => pods(s).some((p) => p.spec.image === DEMO_IMAGE_V1 && p.status.ready),
      9000,
      'a v1 building opens under surge zero',
    )
    expect(deployments(sim.state)[0]!.spec.maxSurgePct).toBe(0)

    // Phase 3 (t≈130): 100/0 contract, back to v2, and the wave completes.
    stepUntil(
      sim,
      (s) => {
        const d = deployments(s)[0]
        return d?.spec.maxSurgePct === 100 && d?.spec.maxUnavailablePct === 0
      },
      9000,
      'unavailable-zero contract filed',
    )
    stepUntil(
      sim,
      (s) =>
        pods(s).filter((p) => p.spec.image === DEMO_IMAGE_V2 && p.status.ready).length >= 3
        && pods(s).every((p) => p.spec.image === DEMO_IMAGE_V2 || p.deletionTimestamp !== undefined),
      20000,
      'v2 completes under unavailable zero',
    )
    sim.endScenario()
  })
})
