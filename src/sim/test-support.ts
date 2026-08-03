/* Kubetropolis sim — shared test harness. Deterministic by construction:
 * fixed step, no wall clock, sims built fresh per test. */

import { createBus } from '../core/bus'
import { MODEL_STEP_SECONDS } from '../core/timebase'
import type { Knobs, PodObj, SimApi, SimState } from '../core/types'
import { createSim } from './model'

export const STEP = MODEL_STEP_SECONDS

export function mkSim(knobs?: Partial<Knobs>, seed?: number): SimApi {
  return createSim(createBus(), { seed, knobs })
}

export function step(sim: SimApi, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.update(STEP)
}

/** Advance until pred is true; throws with a state hint if the budget runs out. */
export function stepUntil(sim: SimApi, pred: (s: SimState) => boolean, maxTicks: number, what = 'condition'): number {
  for (let i = 0; i < maxTicks; i++) {
    if (pred(sim.state)) return i
    sim.update(STEP)
  }
  if (pred(sim.state)) return maxTicks
  throw new Error(
    `${what} not reached in ${maxTicks} ticks (${(maxTicks * STEP).toFixed(1)} model-s); `
      + `vitals=${JSON.stringify(sim.state.vitals)}`,
  )
}

export function pods(s: SimState): PodObj[] {
  const out: PodObj[] = []
  for (const o of s.etcd.objects.values()) if (o.kind === 'Pod') out.push(o)
  return out
}

export function podNamed(s: SimState, prefix: string): PodObj | undefined {
  return pods(s).find((p) => p.name.startsWith(prefix))
}

/** Ticks that comfortably cover admission+fsync+fanout+delivery of one write. */
export const ROUND_TRIP_TICKS = 24
