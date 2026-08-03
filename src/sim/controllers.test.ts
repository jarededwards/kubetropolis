import { describe, expect, it } from 'vitest'

import type { ReplicaSetObj } from '../core/types'
import { samples } from './model'
import { mkSim, pods, stepUntil } from './test-support'

function replicaSets(sim: ReturnType<typeof mkSim>): ReplicaSetObj[] {
  const out: ReplicaSetObj[] = []
  for (const o of sim.state.etcd.objects.values()) {
    if (o.kind === 'ReplicaSet') out.push(o)
  }
  return out
}

describe('controller desks — deployment and replicaset', () => {
  it('one filed paper becomes four: deployment → replicaset → exactly N pods', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsTotal === 3, 1200, '3 pods exist')
    const rses = replicaSets(sim)
    expect(rses.length).toBe(1)
    expect(rses[0].labels['pod-template-hash']).toBe(rses[0].spec.podTemplateHash)
    expect(rses[0].ownerUid).toBeDefined()
    for (const p of pods(sim.state)) {
      expect(p.ownerUid).toBe(rses[0].uid)
      expect(p.labels['pod-template-hash']).toBe(rses[0].spec.podTemplateHash)
    }
    // Expectations held: exactly 3, never a burst of duplicates.
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 2400, 'all ready')
    expect(sim.state.vitals.podsTotal).toBe(3)
  })

  it('nobody restarts your pod: delete one and the desk files a replacement', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 2400, 'steady state')
    const before = pods(sim.state).map((p) => p.name).sort()

    sim.apply(samples.deletePod(before[0]))
    // The victim terminates AND a replacement converges back to 3 ready.
    stepUntil(
      sim,
      (s) => s.vitals.podsReady === 3 && !pods(s).some((p) => p.name === before[0]),
      3600,
      'replacement converged',
    )
    const after = pods(sim.state).map((p) => p.name).sort()
    expect(after.length).toBe(3)
    expect(after).not.toEqual(before)
  })

  it('scale down deletes the surplus deterministically (newest first)', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(4))
    stepUntil(sim, (s) => s.vitals.podsReady === 4, 2400, 'four ready')
    const byAge = pods(sim.state)
      .map((p) => p.name)
      .sort() // names embed the uid suffix; lexicographic == creation order here
    sim.apply(samples.scale(2))
    stepUntil(sim, (s) => s.vitals.podsTotal === 2 && s.vitals.podsReady === 2, 3600, 'scaled to 2')
    const survivors = pods(sim.state).map((p) => p.name).sort()
    expect(survivors).toEqual(byAge.slice(0, 2))
  })

  it('scaling is not a rollout: generation stands still, no second contract opens', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'ready')
    const dep0 = [...sim.state.etcd.objects.values()].find((o) => o.kind === 'Deployment')!
    const gen0 = dep0.generation
    sim.apply(samples.scale(4))
    stepUntil(sim, (s) => s.vitals.podsReady === 4, 2400, 'scaled up')
    const dep1 = [...sim.state.etcd.objects.values()].find((o) => o.kind === 'Deployment')!
    expect(dep1.generation).toBe(gen0)
    expect(replicaSets(sim).length).toBe(1)
  })

  it('desks never touch the street directly: every change is an API write', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    // While anything is still converging, controller-sourced requests appear
    // in the permit hall — proof the desks queue like everyone else.
    stepUntil(
      sim,
      (s) => s.api.inflight.some((r) => r.source.startsWith('ctl.')),
      600,
      'controller write observed in admission',
    )
  })
})
