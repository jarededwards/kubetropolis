import { describe, expect, it } from 'vitest'

import type { NodeObj, PodObj } from '../core/types'
import { samples } from './model'
import { mkSim, podNamed, pods, stepUntil } from './test-support'

describe('scheduler — the zoning office', () => {
  it('binding is a write: the stored pod gains nodeName at a LATER revision', () => {
    const sim = mkSim()
    sim.apply(samples.pod('bindme'))
    stepUntil(sim, (s) => podNamed(s, 'bindme') !== undefined, 30, 'pod stored')
    const rvCreated = podNamed(sim.state, 'bindme')!.resourceVersion
    stepUntil(sim, (s) => podNamed(s, 'bindme')?.spec.nodeName !== undefined, 90, 'bound')
    const bound = podNamed(sim.state, 'bindme')!
    expect(bound.resourceVersion).toBeGreaterThan(rvCreated)
    expect(sim.state.sched.cycle?.chosen).toBe(bound.spec.nodeName)
  })

  it('records per-node filter verdicts and scores for the cycle', () => {
    const sim = mkSim()
    sim.apply(samples.pod('scored'))
    stepUntil(sim, (s) => s.sched.cycle !== undefined, 90, 'cycle ran')
    const cycle = sim.state.sched.cycle!
    expect(cycle.filter.length).toBe(sim.state.nodes.length)
    expect(cycle.score.length).toBeGreaterThan(0)
    expect(cycle.score[0]).toHaveProperty('leastAllocated')
    expect(cycle.score[0]).toHaveProperty('imageLocality')
    expect(cycle.score[0]).toHaveProperty('spread')
  })

  it('filters a cordoned district with its honest plugin name', () => {
    const sim = mkSim({ nodeCount: 2 })
    // cordon node-a directly in the bootstrap state (pre-watch, like initState)
    for (const o of sim.state.etcd.objects.values()) {
      if (o.kind === 'Node' && o.name === 'node-a') (o as NodeObj).spec.unschedulable = true
    }
    sim.apply(samples.pod('avoids-a'))
    stepUntil(sim, (s) => podNamed(s, 'avoids-a')?.spec.nodeName !== undefined, 90, 'bound')
    expect(podNamed(sim.state, 'avoids-a')!.spec.nodeName).toBe('node-b')
    const verdictA = sim.state.sched.cycle!.filter.find((f) => f.node === 'node-a')!
    expect(verdictA.ok).toBe(false)
    expect(verdictA.failed).toBe('Unschedulable')
  })

  it('ResourcesFit: a full district is struck out; nothing fits → backoff + retry', () => {
    const sim = mkSim({ nodeCount: 1, podCpuRequestM: 4000 })
    sim.apply(samples.pod('big-1'))
    stepUntil(sim, (s) => podNamed(s, 'big-1')?.spec.nodeName !== undefined, 120, 'first fits exactly')
    sim.apply(samples.pod('big-2'))
    stepUntil(sim, (s) => s.sched.backoff.length > 0, 120, 'second goes to backoff')
    const verdict = sim.state.sched.cycle!.filter[0]
    expect(verdict.failed).toBe('ResourcesFit')
    expect(sim.state.events.some((e) => e.reason === 'FailedScheduling')).toBe(true)
    // Retry keeps happening deterministically (backoff → queue → backoff)
    stepUntil(sim, (s) => s.sched.backoff.length > 0 || s.sched.queue.length > 0, 300, 'still retrying')
  })

  it('ImageLocality: a district holding the container wins the tie', () => {
    const sim = mkSim({ nodeCount: 2 })
    sim.state.nodes.find((n) => n.id === 'node-b')!.imageCache.add('harbor.city/shopfront:v1')
    sim.apply(samples.pod('cargo-aware'))
    stepUntil(sim, (s) => podNamed(s, 'cargo-aware')?.spec.nodeName !== undefined, 90, 'bound')
    expect(podNamed(sim.state, 'cargo-aware')!.spec.nodeName).toBe('node-b')
  })

  it('spread-lite: deployment replicas land on distinct districts', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(
      sim,
      (s) => pods(s).filter((p: PodObj) => p.spec.nodeName).length === 3,
      1200,
      'all replicas bound',
    )
    const nodesUsed = new Set(pods(sim.state).map((p) => p.spec.nodeName))
    expect(nodesUsed.size).toBe(3)
  })
})
