import { describe, expect, it } from 'vitest'

import { samples } from './model'
import type { SimApi } from '../core/types'
import { mkSim, STEP } from './test-support'

/** The scripted session both runs replay tick-for-tick. */
function scriptedRun(seed: number): SimApi {
  const sim = mkSim(undefined, seed)
  for (let tick = 0; tick < 3000; tick++) {
    if (tick === 0) sim.apply(samples.deployment(3))
    if (tick === 1200) sim.apply(samples.scale(5))
    if (tick === 2000) sim.apply(samples.deletePod('shopfront'))
    sim.update(STEP)
  }
  return sim
}

describe('determinism — same seed, same commands, same steps', () => {
  it('two fresh runs produce deep-equal snapshots', () => {
    const a = scriptedRun(42)
    const b = scriptedRun(42)
    expect(JSON.stringify(a.toSnapshot())).toBe(JSON.stringify(b.toSnapshot()))
    // and the run actually did something worth comparing
    expect(a.state.vitals.podsTotal).toBeGreaterThan(0)
    expect(a.state.etcd.revision).toBeGreaterThan(20)
  })

  it('reset replays identically', () => {
    const sim = mkSim(undefined, 7)
    sim.apply(samples.deployment(2))
    for (let i = 0; i < 900; i++) sim.update(STEP)
    const first = JSON.stringify(sim.toSnapshot())
    sim.reset()
    sim.apply(samples.deployment(2))
    for (let i = 0; i < 900; i++) sim.update(STEP)
    expect(JSON.stringify(sim.toSnapshot())).toBe(first)
  })

  it('paused/zero dt never advances anything', () => {
    const sim = mkSim()
    sim.apply(samples.pod('frozen'))
    const before = JSON.stringify(sim.toSnapshot())
    sim.update(0)
    sim.update(-1)
    expect(JSON.stringify(sim.toSnapshot())).toBe(before)
  })
})
