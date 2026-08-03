/* M8 perf gate — the sim at city-scale limits. Wall-clock is MEASURED for the
 * report but never asserted (deterministic work gets deadlines generous
 * enough that failure means wrong, never busy — vite.config.ts). */

import { describe, expect, it } from 'vitest'

import { samples } from '../src/sim/samples'
import { mkSim, step, stepUntil } from '../src/sim/test-support'

const TICKS_PER_S = 30

describe('city-scale gates', () => {
  it('runs 500 ready pods with bounded per-tick emissions', () => {
    // Tiny requests so 500 pods fit 3 districts (visuals overflow-strip past
    // 12 pads per district by design).
    const sim = mkSim({ podCpuRequestM: 8, podMemRequestMi: 8, reqPerSec: 0 })
    sim.apply(samples.deployment(500))

    const t0 = performance.now()
    stepUntil(sim, (s) => s.vitals.podsReady === 500, 600 * TICKS_PER_S, '500 ready')
    const readyTicks = sim.state.tick
    const t1 = performance.now()

    // Traffic on top: the outbox must be flushed by the facade every tick
    // (observable only post-flush from out here — emptiness IS the contract).
    sim.apply(samples.service())
    sim.setKnob('reqPerSec', 220)
    for (let i = 0; i < 30 * TICKS_PER_S; i++) {
      sim.update(1 / 30)
      expect(sim.state.flowOutbox.length).toBe(0)
    }
    const t2 = performance.now()

    expect(sim.state.sched.backoff.length).toBe(0) // nothing left unschedulable

    // Measured, not asserted — the M8 report's numbers.
    // eslint-disable-next-line no-console
    console.log(
      `[perf] 500 ready in ${readyTicks} ticks; build ${(t1 - t0).toFixed(0)}ms wall; `
        + `900 traffic ticks ${(t2 - t1).toFixed(0)}ms wall`,
    )
  })

  it('keeps the determinism contract at scale', () => {
    const run = (): string => {
      const sim = mkSim({ podCpuRequestM: 8, podMemRequestMi: 8 })
      sim.apply(samples.deployment(120))
      step(sim, 90 * TICKS_PER_S)
      sim.apply(samples.scale(40))
      step(sim, 60 * TICKS_PER_S)
      return JSON.stringify(sim.toSnapshot())
    }
    expect(run()).toBe(run())
  })
})
