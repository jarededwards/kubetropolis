/* M4 — KNOB-AUDIT companion: every wired knob provably changes a bound
 * observable. (Chaos knobs are proven in chaos.test.ts; pacing knobs in
 * rolling.test.ts; timeScale invariance in determinism.test.ts.) */

import { describe, expect, it } from 'vitest'

import { samples } from './samples'
import { mkSim, podNamed, stepUntil } from './test-support'

function ticksToReady(knobs: Parameters<typeof mkSim>[0]): number {
  const sim = mkSim(knobs)
  sim.apply(samples.pod('probe'))
  return stepUntil(sim, (s) => podNamed(s, 'probe')?.status.ready === true, 60000, 'ready')
}

describe('knob → observable', () => {
  it('registryMBps: a slower crane means a later opening', () => {
    expect(ticksToReady({ registryMBps: 15 })).toBeGreaterThan(ticksToReady({ registryMBps: 120 }))
  })

  it('imageSizeMB: heavier cargo means a later opening', () => {
    expect(ticksToReady({ imageSizeMB: 600 })).toBeGreaterThan(ticksToReady({ imageSizeMB: 60 }))
  })

  it('readinessPeriodSec: rarer inspector visits mean slower CLOSED detection', () => {
    // Time-to-first-ready is period-independent (the first visit lands at
    // initialDelay — real semantics). The period's observable is how long a
    // failing door takes to flip CLOSED: failureThreshold consecutive misses.
    const detect = (period: number): number => {
      const sim = mkSim({ readinessPeriodSec: period })
      sim.apply(samples.pod('probe'))
      stepUntil(sim, (s) => podNamed(s, 'probe')?.status.ready === true, 60000, 'ready')
      sim.setKnob('chaosReadinessFlake', true)
      return stepUntil(sim, (s) => podNamed(s, 'probe')?.status.ready === false, 60000, 'CLOSED')
    }
    expect(detect(10)).toBeGreaterThan(detect(5))
  })

  it('initialDelaySec: the grace before the first visit is real', () => {
    expect(ticksToReady({ initialDelaySec: 60 })).toBeGreaterThan(ticksToReady({ initialDelaySec: 0 }))
  })

  it('watchLatencyMs: slower couriers slow the whole journey', () => {
    expect(ticksToReady({ watchLatencyMs: 2000 })).toBeGreaterThan(ticksToReady({ watchLatencyMs: 100 }))
  })

  it('etcdFsyncMs: a slower vault stamp delays every commit', () => {
    expect(ticksToReady({ etcdFsyncMs: 800 })).toBeGreaterThan(ticksToReady({ etcdFsyncMs: 1 }))
  })

  it('tgpsSec: a longer demolition notice keeps the site longer', () => {
    const run = (tgps: number): number => {
      const sim = mkSim({ tgpsSec: tgps, preStopSleepSec: tgps + 5 }) // preStop overruns → SIGKILL at grace(+2)
      sim.apply(samples.pod('doomed'))
      stepUntil(sim, (s) => podNamed(s, 'doomed')?.status.ready === true, 8000, 'up')
      sim.apply(samples.deletePod('doomed'))
      return stepUntil(sim, (s) => podNamed(s, 'doomed') === undefined, 30000, 'gone')
    }
    expect(run(60)).toBeGreaterThan(run(5))
  })

  it('preStopSleepSec delays SIGTERM within the grace, never past it', () => {
    const sim = mkSim({ preStopSleepSec: 10, tgpsSec: 30 })
    sim.apply(samples.pod('polite'))
    stepUntil(sim, (s) => podNamed(s, 'polite')?.status.ready === true, 8000, 'up')
    const t0 = sim.state.now
    sim.apply(samples.deletePod('polite'))
    stepUntil(sim, (s) => podNamed(s, 'polite') === undefined, 30000, 'gone')
    const elapsed = sim.state.now - t0
    // preStop 10 + clean exit ≈ 12 — far inside grace 30, and the sleep is visible
    expect(elapsed).toBeGreaterThan(10)
    expect(elapsed).toBeLessThan(30)
  })

  it('podCpuRequestM: wider buildings fill a district faster', () => {
    const sim = mkSim({ podCpuRequestM: 2000, nodeCount: 1 })
    sim.apply(samples.deployment(3))
    // 3 × 2000m does not fit one 4000m district: someone stays Pending.
    stepUntil(sim, (s) => s.vitals.podsReady === 2 && s.vitals.podsPending >= 1, 12000, 'district full')
    expect(sim.state.events.some((e) => e.reason === 'FailedScheduling')).toBe(true)
  })

  it('nodeCount: more districts light up and spread the load', () => {
    const sim = mkSim({ nodeCount: 5 })
    sim.apply(samples.deployment(5))
    stepUntil(sim, (s) => s.vitals.podsReady === 5, 12000, '5 ready')
    const used = new Set(
      [...sim.state.etcd.objects.values()]
        .filter((o) => o.kind === 'Pod')
        .map((o) => o.spec.nodeName),
    )
    expect(used.size).toBe(5) // spread-lite puts one on each
  })

  /* -- M6 traffic knobs -- */

  function servedAfterRush(knobs: Parameters<typeof mkSim>[0]): { served: number; cpu: number } {
    const sim = mkSim({ reqPerSec: 0, ...knobs })
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 8000, 'ready')
    sim.apply(samples.service())
    stepUntil(sim, (s) => s.vitals.readyEndpoints === 3, 600, 'listed')
    sim.setKnob('reqPerSec', (knobs as { reqPerSec?: number }).reqPerSec ?? 40)
    for (let i = 0; i < 900; i++) sim.update(1 / 30)
    return { served: sim.state.traffic.served, cpu: sim.state.vitals.cpuUsedM }
  }

  it('reqPerSec: more callers, more served, hotter substations', () => {
    const quiet = servedAfterRush({ reqPerSec: 20 })
    const rush = servedAfterRush({ reqPerSec: 200 })
    expect(rush.served).toBeGreaterThan(quiet.served * 5)
    expect(rush.cpu).toBeGreaterThan(quiet.cpu * 5)
  })

  it('reqCpuCostM: pricier requests draw more power at the same rate', () => {
    const cheap = servedAfterRush({ reqPerSec: 100, reqCpuCostM: 5 })
    const dear = servedAfterRush({ reqPerSec: 100, reqCpuCostM: 40 })
    expect(Math.abs(cheap.served - dear.served)).toBeLessThan(cheap.served * 0.02)
    expect(dear.cpu).toBeGreaterThan(cheap.cpu * 4)
  })
})
