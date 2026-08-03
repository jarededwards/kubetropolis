import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import type { PodObj } from '../core/types'
import { samples } from './model'
import { mkSim, podNamed, pods, STEP, stepUntil } from './test-support'

describe('kubelet — the foreman', () => {
  it('walks a pod Pending → pulling → creating → Running, each via a status write', () => {
    const sim = mkSim({ nodeCount: 1 })
    sim.apply(samples.pod('walker'))
    stepUntil(sim, (s) => podNamed(s, 'walker')?.status.container.state === 'pulling', 600, 'pulling')
    expect(podNamed(sim.state, 'walker')!.status.phase).toBe('Pending')
    stepUntil(sim, (s) => podNamed(s, 'walker')?.status.container.state === 'creating', 600, 'creating')
    stepUntil(sim, (s) => podNamed(s, 'walker')?.status.phase === 'Running', 600, 'Running')
    expect(podNamed(sim.state, 'walker')!.status.startedAt).toBeGreaterThan(0)
  })

  it('pull duration is size over rate; the harbor caches the image afterwards', () => {
    const sim = mkSim({ nodeCount: 1 })
    sim.apply(samples.pod('cargo'))
    stepUntil(sim, (s) => s.nodes[0].pulls.length === 1, 600, 'pull queued')
    const pullStartTick = sim.state.tick
    stepUntil(sim, (s) => s.nodes[0].pulls.length === 0, 600, 'pull done')
    const pullTicks = sim.state.tick - pullStartTick
    const expectedSeconds = sim.state.knobs.imageSizeMB / sim.state.knobs.registryMBps
    expect(pullTicks * STEP).toBeGreaterThanOrEqual(expectedSeconds - 0.2)
    expect(pullTicks * STEP).toBeLessThanOrEqual(expectedSeconds + 0.5)
    expect(sim.state.nodes[0].imageCache.has('harbor.city/shopfront:v1')).toBe(true)
  })

  it('serializes pulls per district and skips the harbor entirely on a cache hit', () => {
    const sim = mkSim({ nodeCount: 1 })
    sim.apply(samples.pod('first'))
    sim.apply(samples.pod('second'))
    // Both pods bind to the single node; at some point both pulls are queued.
    stepUntil(sim, (s) => s.nodes[0].pulls.length === 2, 900, 'both queued')
    // Serialized: the second waits while the first is active.
    const active = sim.state.nodes[0].pulls[0]
    expect(sim.state.nodes[0].pulls[1].doneMB).toBe(0)
    void active
    stepUntil(sim, (s) => s.vitals.podsRunning === 2, 1200, 'both running')

    // Third pod: image cached — goes straight to creating, no pull entry.
    sim.apply(samples.pod('third'))
    stepUntil(sim, (s) => podNamed(s, 'third')?.status.phase === 'Running', 900, 'third running')
    const podThird = podNamed(sim.state, 'third')!
    expect(podThird.status.container.state).toBe('running')
    expect(sim.state.events.filter((e) => e.reason === 'Pulling').length).toBe(2)
  })

  it('readiness gates listing: ready flips only after the probe passes', () => {
    const sim = mkSim({ nodeCount: 1 })
    sim.apply(samples.pod('gated'))
    stepUntil(sim, (s) => podNamed(s, 'gated')?.status.phase === 'Running', 900, 'running')
    stepUntil(sim, (s) => podNamed(s, 'gated')?.status.ready === true, 600, 'ready')
    expect(sim.state.events.some((e) => e.reason === 'Ready')).toBe(true)
  })

  it('chaosCrashLoop climbs the ladder: 10, 20, 40 — and CrashLoopBackOff is visible', () => {
    const sim = mkSim({ nodeCount: 1, chaosCrashLoop: true })
    sim.apply(samples.pod('crashy'))

    const ladder: number[] = []
    let lastRestarts = 0
    // Observe the first three rungs (crash after 20s, backoffs 10+20+40 ≈ 130 model-s + startup)
    stepUntil(
      sim,
      (s) => {
        const pod = podNamed(s, 'crashy')
        if (!pod) return false
        if (pod.status.container.restartCount > lastRestarts) {
          lastRestarts = pod.status.container.restartCount
          ladder.push(pod.status.container.backoffSec)
        }
        return ladder.length >= 3
      },
      3600 * 3,
      'three restarts observed',
    )
    expect(ladder).toEqual([
      CLAIM_VALUES.crashLoop.baseSeconds,
      CLAIM_VALUES.crashLoop.baseSeconds * 2,
      CLAIM_VALUES.crashLoop.baseSeconds * 4,
    ])
    const pod = podNamed(sim.state, 'crashy')!
    expect(pod.status.container.reason).toBe('CrashLoopBackOff')
    expect(sim.state.events.some((e) => e.reason === 'BackOff')).toBe(true)
  })

  it('OOM is arithmetic: exit 137, lastExitReason OOMKilled, waiting reason CrashLoopBackOff', () => {
    // The honest path (M4): the leaky v2 image grows its working set until
    // the kernel — not Kubernetes — pulls the breaker.
    const sim = mkSim({ nodeCount: 1, chaosOomLeak: true })
    sim.apply({ kind: 'ApplyPod', name: 'leaky', image: 'harbor.city/shopfront:v2' })
    stepUntil(sim, (s) => podNamed(s, 'leaky')?.status.phase === 'Running', 900, 'running')
    stepUntil(sim, (s) => podNamed(s, 'leaky')?.status.container.exitCode === 137, 3000, 'OOM kill')
    // The kubectl flicker (fidelity A6): WHY the last run died is OOMKilled;
    // WHAT the container is doing now is CrashLoopBackOff.
    const c = podNamed(sim.state, 'leaky')!.status.container
    expect(c.lastExitReason).toBe('OOMKilled')
    expect(c.reason).toBe('CrashLoopBackOff')
    expect(c.restartCount).toBe(1)
  })

  it('graceful termination: preStop, SIGTERM, then the final paperwork removes the row', () => {
    const sim = mkSim({ nodeCount: 1 })
    sim.apply(samples.pod('doomed'))
    stepUntil(sim, (s) => podNamed(s, 'doomed')?.status.ready === true, 1200, 'ready')
    sim.apply(samples.deletePod('doomed'))
    stepUntil(sim, (s) => podNamed(s, 'doomed')?.deletionTimestamp !== undefined, 300, 'terminating')
    expect(podNamed(sim.state, 'doomed')!.status.container.state === 'terminating'
      || podNamed(sim.state, 'doomed')!.status.container.state === 'running').toBe(true)
    stepUntil(sim, (s) => podNamed(s, 'doomed') === undefined, 900, 'removed')
    // A bare pod has no owner: nothing rebuilds it.
    expect(pods(sim.state).length).toBe(0)
    expect(sim.state.events.some((e) => e.reason === 'Killing')).toBe(true)
  })

  it('a pod that never scheduled deletes immediately — no foreman, no grace', () => {
    const sim = mkSim({ nodeCount: 1, podCpuRequestM: 9000 }) // can never fit
    sim.apply(samples.pod('stuck'))
    stepUntil(sim, (s) => podNamed(s, 'stuck') !== undefined, 60, 'stored')
    stepUntil(sim, (s) => s.sched.backoff.length > 0, 300, 'unschedulable')
    sim.apply(samples.deletePod('stuck'))
    stepUntil(sim, (s) => podNamed(s, 'stuck') === undefined, 300, 'gone in one write')
  })
})
