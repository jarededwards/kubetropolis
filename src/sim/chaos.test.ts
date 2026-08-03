/* M4 — chaos mechanisms: every breakage shows its real Kubernetes signature.
 * CrashLoopBackOff ladder (claims: crashloop.backoff), OOM exit 137 with the
 * kubectl flicker (lastExitReason), ErrImagePull → ImagePullBackOff ladder
 * (claims: images.backoffCap), cached-layer bypass, readiness flake windows. */

import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import { DEMO_IMAGE_V1, DEMO_IMAGE_V2, samples } from './samples'
import { mkSim, podNamed, step, stepUntil } from './test-support'

describe('chaosCrashLoop', () => {
  it('climbs the doubling ladder with Error as the last exit', () => {
    const sim = mkSim({ chaosCrashLoop: true })
    sim.apply(samples.pod('crashy'))
    stepUntil(sim, (s) => (podNamed(s, 'crashy')?.status.container.restartCount ?? 0) >= 3, 60000, '3 restarts')
    const c = podNamed(sim.state, 'crashy')!.status.container
    // 10 → 20 → 40: the third rung
    expect(c.backoffSec).toBe(CLAIM_VALUES.crashLoop.baseSeconds * 4)
    expect(c.reason).toBe('CrashLoopBackOff')
    expect(c.lastExitReason).toBe('Error')
  })
})

describe('chaosOomLeak', () => {
  it('v2 grows past its limit, exits 137, and leaks again after restart', () => {
    const sim = mkSim({ chaosOomLeak: true })
    sim.apply({ kind: 'ApplyPod', name: 'leaky', image: DEMO_IMAGE_V2 })
    stepUntil(
      sim,
      (s) => podNamed(s, 'leaky')?.status.container.exitCode === 137,
      60000,
      'first OOM kill',
    )
    const first = podNamed(sim.state, 'leaky')!.status.container
    expect(first.lastExitReason).toBe('OOMKilled')
    expect(first.reason).toBe('CrashLoopBackOff') // the kubectl flicker settles here
    // The leak survives the restart: it OOMs again.
    stepUntil(
      sim,
      (s) => (podNamed(s, 'leaky')?.status.container.restartCount ?? 0) >= 2,
      90000,
      'second OOM kill',
    )
    expect(podNamed(sim.state, 'leaky')!.status.container.lastExitReason).toBe('OOMKilled')
  })

  it('v1 does not leak', () => {
    const sim = mkSim({ chaosOomLeak: true })
    sim.apply({ kind: 'ApplyPod', name: 'steady', image: DEMO_IMAGE_V1 })
    stepUntil(sim, (s) => podNamed(s, 'steady')?.status.ready === true, 6000, 'ready')
    step(sim, 3000) // 100 model-seconds under the same chaos knob
    expect(podNamed(sim.state, 'steady')!.status.container.restartCount).toBe(0)
  })
})

describe('chaosRegistryOutage', () => {
  it('fails pulls into the ErrImagePull → ImagePullBackOff ladder, then recovers', () => {
    const sim = mkSim({ chaosRegistryOutage: true })
    sim.apply(samples.pod('fogged'))
    stepUntil(
      sim,
      (s) => podNamed(s, 'fogged')?.status.container.reason === 'ErrImagePull',
      6000,
      'ErrImagePull',
    )
    stepUntil(
      sim,
      (s) => podNamed(s, 'fogged')?.status.container.reason === 'ImagePullBackOff',
      6000,
      'ImagePullBackOff',
    )
    // The ladder doubles: two distinct rungs appear in the event record.
    stepUntil(
      sim,
      (s) =>
        s.events.some((e) => e.reason === 'PullFailed' && e.message.includes(`retry in ${CLAIM_VALUES.imagePull.backoffBaseSeconds}`))
        && s.events.some((e) => e.reason === 'PullFailed' && e.message.includes(`retry in ${CLAIM_VALUES.imagePull.backoffBaseSeconds * 2}`)),
      30000,
      'two ladder rungs',
    )
    // The fog lifts; the next retry succeeds and the pod comes up.
    sim.setKnob('chaosRegistryOutage', false)
    stepUntil(sim, (s) => podNamed(s, 'fogged')?.status.ready === true, 30000, 'recovered to Ready')
  })

  it('a district that already holds the image keeps building through the fog', () => {
    const sim = mkSim()
    sim.apply(samples.pod('warm'))
    stepUntil(sim, (s) => podNamed(s, 'warm')?.status.ready === true, 8000, 'cache warmed')
    const cachedNode = podNamed(sim.state, 'warm')!.spec.nodeName!

    sim.setKnob('chaosRegistryOutage', true)
    sim.apply(samples.pod('fromshelf'))
    stepUntil(sim, (s) => podNamed(s, 'fromshelf')?.status.ready === true, 8000, 'built from the shelf')
    // ImageLocality steered it to the shelf that already had the cargo.
    expect(podNamed(sim.state, 'fromshelf')!.spec.nodeName).toBe(cachedNode)
  })
})

describe('chaosReadinessFlake', () => {
  it('flips the CLOSED sign both ways without a single restart', () => {
    const sim = mkSim()
    sim.apply(samples.pod('flaky'))
    stepUntil(sim, (s) => podNamed(s, 'flaky')?.status.ready === true, 8000, 'ready')
    sim.setKnob('chaosReadinessFlake', true)
    stepUntil(sim, (s) => podNamed(s, 'flaky')?.status.ready === false, 30000, 'CLOSED')
    stepUntil(sim, (s) => podNamed(s, 'flaky')?.status.ready === true, 30000, 'reopened')
    expect(podNamed(sim.state, 'flaky')!.status.container.restartCount).toBe(0)
  })
})
