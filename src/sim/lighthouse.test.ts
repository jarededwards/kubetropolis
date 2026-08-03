/* M7 — CRDs and the lighthouse operator.
 *
 * The teaching arc under test: a CR without its CRD is rejected with the real
 * error; a CR with no operator is stored and nothing else; a staffed operator
 * builds, ignites, and keeps fuel in the beacon forever; unstaffing lets
 * drift win. Determinism: the whole arc snapshots byte-identically.
 */

import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import type { LighthouseObj, SimApi } from '../core/types'
import { createBus } from '../core/bus'
import { createSim, samples } from './model'
import { OPERATOR_LATENCY_FACTOR } from './apiserver'

const LH = CLAIM_VALUES.modelLighthouse

function mkSim(): SimApi {
  return createSim(createBus())
}

/** advance n model seconds in fixed 1/30 bites (the timebase contract) */
function run(sim: SimApi, seconds: number): void {
  const steps = Math.round(seconds * 30)
  for (let i = 0; i < steps; i++) sim.update(1 / 30)
}

function lighthouse(sim: SimApi): LighthouseObj | undefined {
  for (const o of sim.state.etcd.objects.values()) {
    if (o.kind === 'Lighthouse') return o as LighthouseObj
  }
  return undefined
}

describe('CRD registration gates the custom kind', () => {
  it('rejects a Lighthouse before the CRD exists, with the real error', () => {
    const sim = mkSim()
    sim.apply(samples.lighthouse())
    run(sim, 2)
    expect(lighthouse(sim)).toBeUndefined()
    expect(sim.state.api.rejected).toBe(1)
    const rejection = sim.state.events.find((e) => e.reason === 'KindNotRegistered')
    expect(rejection?.message).toBe('no matches for kind "Lighthouse" in group "harbor.city"')
  })

  it('admits the same manifest once the CRD is registered', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    expect(sim.state.vitals.crdRegistered).toBe(true)
    sim.apply(samples.lighthouse())
    run(sim, 2)
    const cr = lighthouse(sim)
    expect(cr).toBeDefined()
    expect(cr!.spec.beamRpm).toBe(6)
    expect(cr!.resourceVersion).toBeGreaterThan(0)
  })

  it('registration alone changes nothing else: no controller, no beacon', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 10)
    expect(sim.state.beacon).toBeNull()
    expect(sim.state.controllers.lighthouse.reconciles).toBe(0)
  })
})

describe('a law with no inspector is paper', () => {
  it('an admitted CR with no operator produces a row and nothing else', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.apply(samples.lighthouse())
    run(sim, 60)
    expect(lighthouse(sim)).toBeDefined()
    expect(sim.state.beacon).toBeNull() // the breakwater is dark — no structure at all
    expect(sim.state.controllers.lighthouse.reconciles).toBe(0)
    expect(lighthouse(sim)!.status.lit).toBe(false)
  })

  it('the row outlives patience: still inert hundreds of model seconds later', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.apply(samples.lighthouse())
    run(sim, 400)
    expect(sim.state.beacon).toBeNull()
    expect(lighthouse(sim)!.status.lit).toBe(false)
  })
})

describe('the staffed operator', () => {
  function litSim(): SimApi {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.apply(samples.lighthouse())
    run(sim, 3)
    sim.apply(samples.setOperator(true))
    run(sim, 3 + LH.buildSeconds + 2)
    return sim
  }

  it('holds its watch on the longest road in the city', () => {
    const sim = mkSim()
    sim.apply(samples.setOperator(true))
    run(sim, 1)
    const op = sim.state.api.watchers.find((w) => w.subscriber === 'operator')
    expect(op).toBeDefined()
    expect(op!.latencyFactor).toBe(OPERATOR_LATENCY_FACTOR)
    for (const w of sim.state.api.watchers) {
      if (w.subscriber !== 'operator') expect(w.latencyFactor).toBeLessThan(OPERATOR_LATENCY_FACTOR)
    }
  })

  it('builds the tower, then ignites it, and publishes status through the API', () => {
    const sim = litSim()
    expect(sim.state.beacon?.built).toBe(true)
    expect(sim.state.beacon?.lit).toBe(true)
    const cr = lighthouse(sim)!
    expect(cr.status.lit).toBe(true) // published, not street-poked
    expect(sim.state.controllers.lighthouse.reconciles).toBeGreaterThan(0)
  })

  it('dispatches a refuel below the threshold and restores fuel only on ARRIVAL', () => {
    const sim = litSim()
    // burn down toward the threshold: (100 - refuelBelowPct) / decay
    const burnSeconds = (100 - LH.refuelBelowPct) / LH.fuelDecayPctPerSec
    run(sim, burnSeconds + 8)
    const dispatched = sim.state.events.some((e) => e.reason === 'RefuelDispatched')
    expect(dispatched).toBe(true)
    // mid-flight: fuel still low until the truck arrives
    const midFuel = sim.state.beacon!.fuelPct
    expect(midFuel).toBeLessThan(LH.refuelBelowPct + 5)
    run(sim, LH.refuelTravelSeconds + 4)
    expect(sim.state.beacon!.fuelPct).toBeGreaterThan(90)
    const cr = lighthouse(sim)!
    expect(cr.status.lastMaintainedAt).toBeGreaterThan(0)
  })

  it('keeps the beacon lit indefinitely — reconciliation is an occupation', () => {
    const sim = litSim()
    run(sim, 600)
    expect(sim.state.beacon?.lit).toBe(true)
    expect(sim.state.beacon!.fuelPct).toBeGreaterThan(0)
  })
})

describe('unstaffing lets drift win', () => {
  it('fuel decays to zero and the breakwater goes dark; the ledger goes stale', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.apply(samples.lighthouse())
    run(sim, 3)
    sim.apply(samples.setOperator(true))
    run(sim, 3 + LH.buildSeconds + 2)
    expect(sim.state.beacon?.lit).toBe(true)
    sim.apply(samples.setOperator(false))
    run(sim, 1)
    expect(sim.state.api.watchers.some((w) => w.subscriber === 'operator')).toBe(false)
    // burn everything: 100% at the decay rate, plus margin
    run(sim, 100 / LH.fuelDecayPctPerSec + 10)
    expect(sim.state.beacon!.lit).toBe(false)
    expect(sim.state.beacon!.fuelPct).toBe(0)
    // the vault still shows the operator's LAST publish — stale, and honest
    const cr = lighthouse(sim)!
    expect(cr.status.lit).toBe(true)
    expect(sim.state.events.some((e) => e.reason === 'BeaconDark')).toBe(true)
  })

  it('re-staffing heals: the desk relists, refuels, and re-ignites', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.apply(samples.lighthouse())
    run(sim, 3)
    sim.apply(samples.setOperator(true))
    run(sim, 3 + LH.buildSeconds + 2)
    sim.apply(samples.setOperator(false))
    run(sim, 100 / LH.fuelDecayPctPerSec + 10) // dark
    sim.apply(samples.setOperator(true))
    run(sim, LH.refuelTravelSeconds + 8)
    expect(sim.state.beacon!.lit).toBe(true)
    expect(sim.state.beacon!.fuelPct).toBeGreaterThan(50)
  })
})

describe('the rails', () => {
  it('apply-crd walks CLIENT→ADMIT→LEDGER→FANOUT→RECEIPT, stop by stop', () => {
    // Step mode is the honest instrument here: live mode may cross several
    // satisfiable stops inside one tick's advance loop.
    const sim = mkSim()
    sim.startTrace('apply-crd', 'step')
    const seen: string[] = [sim.state.trace!.stop]
    for (let guard = 0; guard < 40 && sim.state.trace!.stop !== 'done'; guard++) {
      sim.traceNext()
      for (let i = 0; i < 30 * 20 && !sim.state.trace!.autoPaused; i++) sim.update(1 / 30)
      seen.push(sim.state.trace!.stop)
    }
    expect(seen).toEqual(['client', 'admission', 'etcd_commit', 'watch_fanout', 'done'])
    expect(sim.state.trace?.rejectedError).toBe('')
  })

  it('apply-lighthouse without the CRD goes straight to the receipt with the error', () => {
    const sim = mkSim()
    sim.startTrace('apply-lighthouse', 'live')
    for (let i = 0; i < 30 * 10 && sim.state.trace?.stop !== 'done'; i++) sim.update(1 / 30)
    expect(sim.state.trace?.stop).toBe('done')
    expect(sim.state.trace?.rejectedError).toContain('no matches for kind')
    expect(lighthouse(sim)).toBeUndefined()
  })

  it('apply-lighthouse holds at OPERATOR while unstaffed, then rides staffing to BEACON', () => {
    const sim = mkSim()
    sim.apply(samples.crd())
    run(sim, 2)
    sim.startTrace('apply-lighthouse', 'live')
    run(sim, 20)
    expect(sim.state.trace?.stop).toBe('operator') // the hold IS the lesson
    expect(sim.state.trace?.operatorStaffed).toBe(false)
    sim.apply(samples.setOperator(true)) // the try-the-fix path
    run(sim, LH.buildSeconds + 8)
    const t = sim.state.trace
    expect(t && ['beacon', 'done'].includes(t.stop)).toBe(true)
    expect(sim.state.beacon?.lit).toBe(true)
  })
})

describe('determinism', () => {
  it('the full arc snapshots byte-identically across two fresh runs', () => {
    const script = (sim: SimApi): void => {
      sim.apply(samples.crd())
      run(sim, 2)
      sim.apply(samples.lighthouse())
      run(sim, 30)
      sim.apply(samples.setOperator(true))
      run(sim, 120)
      sim.apply(samples.setOperator(false))
      run(sim, 90)
      sim.apply(samples.setOperator(true))
      run(sim, 60)
    }
    const a = mkSim()
    const b = mkSim()
    script(a)
    script(b)
    expect(JSON.stringify(a.toSnapshot())).toBe(JSON.stringify(b.toSnapshot()))
  })
})
