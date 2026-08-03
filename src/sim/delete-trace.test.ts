/* M6 — the delete rail: ordering is the content.
 *
 * The rail is driven exactly as the UI drives it. Under live traffic the
 * misroute counter is the lesson; with the preStop fix it stays at zero; with
 * no Service the rail runs its honest no-traffic variant.
 */

import { describe, expect, it } from 'vitest'

import { createBus } from '../core/bus'
import { MODEL_STEP_SECONDS as DT } from '../core/timebase'
import { PRESENTED_DELETE_STAGES } from '../core/trace-presentation'
import type { SimApi, TraceStop } from '../core/types'
import { createSim } from './model'
import { samples } from './samples'

function mkSim(): SimApi {
  return createSim(createBus())
}

function run(sim: SimApi, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) sim.update(DT)
}

function readyCity(sim: SimApi, reqPerSec = 120): void {
  sim.setKnob('reqPerSec', 0)
  sim.apply(samples.deployment(3))
  run(sim, 60)
  expect(sim.state.vitals.podsReady).toBe(3)
  sim.apply(samples.service())
  run(sim, 10)
  expect(sim.state.vitals.readyEndpoints).toBe(3)
  sim.setKnob('reqPerSec', reqPerSec)
  run(sim, 10)
}

function stepToNextStop(sim: SimApi, maxSeconds = 120): TraceStop {
  sim.traceNext()
  const steps = Math.round(maxSeconds / DT)
  for (let i = 0; i < steps; i++) {
    if (sim.state.trace?.autoPaused) break
    if (sim.state.knobs.paused) break
    sim.update(DT)
  }
  expect(sim.state.trace, 'trace vanished while stepping').not.toBeNull()
  return sim.state.trace!.stop
}

function deleteRailSequence(sim: SimApi): TraceStop[] {
  sim.startTrace('delete-pod', 'step')
  const seen: TraceStop[] = [sim.state.trace!.stop]
  for (let i = 0; i < PRESENTED_DELETE_STAGES.length + 2 && sim.state.trace!.stop !== 'done'; i++) {
    seen.push(stepToNextStop(sim))
  }
  return seen
}

describe('delete rail — under live traffic', () => {
  it('walks the nine stops in canonical order', () => {
    const sim = mkSim()
    readyCity(sim)
    const seq = deleteRailSequence(sim)
    expect(seq).toEqual(PRESENTED_DELETE_STAGES.map((s) => s.stop))
    sim.endTrace()
  })

  it('races: misroutes counted, replacement filed, evidence captured', () => {
    const sim = mkSim()
    readyCity(sim)
    sim.startTrace('delete-pod', 'live')
    run(sim, 120)
    const t = sim.state.trace!
    expect(t.stop).toBe('done')
    expect(t.trafficLive).toBe(true)
    expect(t.deleteRev).toBeGreaterThan(0)
    expect(t.withdrawRev).toBeGreaterThan(t.deleteRev)
    expect(t.districtsProgrammed).toBe(t.districtsTotal)
    expect(t.misroutedSince).toBeGreaterThan(0)
    expect(t.replacementName).toMatch(/^shopfront-/)
    expect(t.removed).toBe(true)
    expect(t.cleanExit).toBe(true) // the model app exits promptly after SIGTERM
    expect(t.suggestedPreStopSec).toBeGreaterThanOrEqual(2)
    sim.endTrace()
  })

  it('the fix: preStop beyond the propagation → zero misroutes on the rail', () => {
    const sim = mkSim()
    readyCity(sim)
    sim.setKnob('preStopSleepSec', 4)
    sim.startTrace('delete-pod', 'live')
    run(sim, 120)
    const t = sim.state.trace!
    expect(t.stop).toBe('done')
    expect(t.misroutedSince).toBe(0)
    expect(t.sigtermLandedAt).toBeGreaterThan(t.deletedAt + 3)
    sim.endTrace()
  })

  it('two fresh step-runs pause at identical stops (deterministic)', () => {
    const a = mkSim()
    const b = mkSim()
    readyCity(a)
    readyCity(b)
    expect(deleteRailSequence(a)).toEqual(deleteRailSequence(b))
  })
})

describe('delete rail — honest variants', () => {
  it('no Service: the withdraw stop passes with the no-traffic variant', () => {
    const sim = mkSim()
    sim.setKnob('reqPerSec', 0)
    sim.apply(samples.deployment(3))
    run(sim, 60)
    sim.startTrace('delete-pod', 'live')
    run(sim, 90)
    const t = sim.state.trace!
    expect(t.stop).toBe('done')
    expect(t.trafficLive).toBe(false)
    expect(t.withdrawRev).toBe(0)
    expect(t.misroutedSince).toBe(0)
    expect(t.replacementName).toMatch(/^shopfront-/)
    sim.endTrace()
  })

  it('the rail restores every knob on close', () => {
    const sim = mkSim()
    readyCity(sim)
    const before = { ...sim.state.knobs }
    sim.startTrace('delete-pod', 'slow')
    run(sim, 5)
    expect(sim.state.knobs.timeScale).not.toBe(before.timeScale)
    sim.endTrace()
    expect(sim.state.knobs).toEqual(before)
  })
})
