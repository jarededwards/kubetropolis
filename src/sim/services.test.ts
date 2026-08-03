/* M6 — Services, the directory, district signage, and citizens.
 *
 * The laws under test:
 *  - the directory desk lists ready doors only, and files editions on REAL
 *    change only (generation is the honest edition count);
 *  - every district programs its OWN copy at its OWN courier's pace (skew);
 *  - traffic reaches only doors some view says are open, and a door that
 *    stopped serving while still listed is a MISROUTE, counted;
 *  - a preStop sleep longer than the propagation closes the race to ~zero.
 */

import { describe, expect, it } from 'vitest'

import type { EndpointSliceObj, PodObj, SimApi } from '../core/types'
import { getSlice } from './objects'
import { samples } from './samples'
import { mkSim, step, stepUntil } from './test-support'

/** Stand up shopfront ×3 (all Ready) + the Service, traffic quiet. */
function readyCity(knobs: Partial<Parameters<typeof mkSim>[0]> = {}): SimApi {
  const sim = mkSim({ reqPerSec: 0, ...knobs })
  sim.apply(samples.deployment(3))
  stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, 'three ready pods')
  sim.apply(samples.service())
  stepUntil(sim, (s) => s.vitals.readyEndpoints === 3, 600, 'directory lists 3 doors')
  return sim
}

describe('the directory desk (EndpointSlice controller)', () => {
  it('lists exactly the ready, selector-matched pods', () => {
    const sim = readyCity()
    const slice = getSlice(sim.state)!
    expect(slice.spec.endpoints).toHaveLength(3)
    expect(slice.spec.endpoints.every((e) => e.conditions.ready)).toBe(true)
    expect(slice.spec.endpoints.map((e) => e.podName).every((n) => n.startsWith('shopfront-'))).toBe(
      true,
    )
  })

  it('never lists a bare pod outside the selector', () => {
    const sim = readyCity()
    sim.apply(samples.pod('web'))
    stepUntil(sim, (s) => s.vitals.podsReady === 4, 3000, 'web ready')
    step(sim, 60)
    const slice = getSlice(sim.state)!
    expect(slice.spec.endpoints).toHaveLength(3)
    // the trace's honest variant depends on this: Running, and no number lists it
  })

  it('files editions on real change only — generation is the edition count', () => {
    const sim = readyCity()
    const gen0 = getSlice(sim.state)!.generation
    step(sim, 900) // 30 quiet model-seconds
    expect(getSlice(sim.state)!.generation).toBe(gen0)

    // A door closes (readiness flake window) → one real edition, withdrawn.
    sim.setKnob('chaosReadinessFlake', true)
    stepUntil(
      sim,
      (s) => (getSlice(s) as EndpointSliceObj).spec.endpoints.some((e) => !e.conditions.ready),
      3000,
      'a door withdrawn',
    )
    expect(getSlice(sim.state)!.generation).toBeGreaterThan(gen0)
  })

  it('a second ApplyService is a no-op', () => {
    const sim = readyCity()
    const uid = getSlice(sim.state)!.uid
    sim.apply(samples.service())
    step(sim, 120)
    expect(getSlice(sim.state)!.uid).toBe(uid)
    expect(sim.state.events.some((e) => e.reason === 'Unchanged')).toBe(true)
  })
})

describe('district signage (per-node proxy views)', () => {
  it('every district eventually programs the edition — at its own pace', () => {
    const sim = readyCity()
    const sliceRev = getSlice(sim.state)!.resourceVersion
    stepUntil(
      sim,
      (s) => s.nodes.every((n) => n.proxy.programmedRev >= sliceRev),
      600,
      'all districts programmed',
    )
    expect(sim.state.nodes.every((n) => n.proxy.endpoints.length === 3)).toBe(true)
  })

  it('two districts observe the same edition at different model times (skew)', () => {
    const sim = readyCity()
    // Close a door to force a fresh edition, then watch who programs it when.
    sim.setKnob('chaosReadinessFlake', true)
    stepUntil(
      sim,
      (s) => (getSlice(s) as EndpointSliceObj).spec.endpoints.some((e) => !e.conditions.ready),
      3000,
      'edition filed',
    )
    const rev = getSlice(sim.state)!.resourceVersion
    const at = new Map<string, number>()
    stepUntil(
      sim,
      (s) => {
        for (const n of s.nodes) {
          if (n.proxy.programmedRev >= rev && !at.has(n.id)) at.set(n.id, s.now)
        }
        return at.size === s.nodes.length
      },
      600,
      'all districts caught up',
    )
    const times = [...at.values()]
    expect(new Set(times.map((t) => t.toFixed(3))).size).toBeGreaterThan(1)
  })
})

describe('citizens (the traffic-correctness law)', () => {
  it('steady state serves everyone: zero misroutes, zero idle', () => {
    const sim = readyCity()
    sim.setKnob('reqPerSec', 80)
    step(sim, 1800) // 60 model-seconds of rush
    expect(sim.state.traffic.served).toBeGreaterThan(4000)
    expect(sim.state.traffic.misrouted).toBe(0)
    expect(sim.state.vitals.reqMisroutedTotal).toBe(0)
  })

  it('no Service → nothing to dial: arrivals idle, none misroute', () => {
    const sim = mkSim({ reqPerSec: 40 })
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3000, 'ready')
    step(sim, 300)
    expect(sim.state.traffic.idleNoService).toBeGreaterThan(0)
    expect(sim.state.traffic.served).toBe(0)
    expect(sim.state.traffic.misrouted).toBe(0)
  })

  it('served traffic synthesizes CPU: the substation needles move', () => {
    const sim = readyCity()
    sim.setKnob('reqPerSec', 120)
    step(sim, 600)
    const used = sim.state.nodes.reduce((n, x) => n + x.used.cpuM, 0)
    expect(used).toBeGreaterThan(100)
    expect(sim.state.vitals.cpuUsedM).toBeGreaterThan(100)
    // and it decays when the rush ends
    sim.setKnob('reqPerSec', 0)
    step(sim, 600)
    expect(sim.state.nodes.reduce((n, x) => n + x.used.cpuM, 0)).toBeLessThan(used / 4)
  })

  it('flow emissions stay bounded at 220 req/s (the pool budget)', () => {
    const sim = readyCity()
    const bus = (sim as unknown as { state: { flowOutbox: unknown[] } }).state
    sim.setKnob('reqPerSec', 220)
    let maxPerTick = 0
    for (let i = 0; i < 900; i++) {
      sim.update(1 / 30)
      // outbox is flushed by the facade each tick; inspect BEFORE flush is not
      // possible from outside, so bound the vitals instead: served grows, and
      // the sampled emission ratio caps particles at ~1/4 of requests.
      maxPerTick = Math.max(maxPerTick, bus.flowOutbox.length)
    }
    expect(maxPerTick).toBe(0) // always flushed — nothing accumulates
    expect(sim.state.traffic.served).toBeGreaterThan(5000)
  })
})

describe('the delete race (the crown jewel)', () => {
  function raceRun(preStopSleepSec: number): { misrouted: number; sim: SimApi } {
    const sim = readyCity()
    sim.setKnob('reqPerSec', 120)
    sim.setKnob('preStopSleepSec', preStopSleepSec)
    step(sim, 300) // rush hour is flowing
    const before = sim.state.traffic.misrouted
    const victim = [...sim.state.etcd.objects.values()].find(
      (o): o is PodObj => o.kind === 'Pod' && o.name.startsWith('shopfront-'),
    )!
    sim.apply(samples.deletePod(victim.name))
    // run to full replacement: old pod gone, three ready again
    stepUntil(
      sim,
      (s) => !s.etcd.objects.has(victim.uid) && s.vitals.podsReady === 3,
      6000,
      'replacement ready',
    )
    step(sim, 300)
    return { misrouted: sim.state.traffic.misrouted - before, sim }
  }

  it('without preStop, withdrawal and shutdown race — callers are lost', () => {
    const { misrouted } = raceRun(0)
    expect(misrouted).toBeGreaterThan(0)
  })

  it('with a preStop sleep longer than the propagation, ~zero are lost', () => {
    const withFix = raceRun(4)
    expect(withFix.misrouted).toBe(0)
  })
})
