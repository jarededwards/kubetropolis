/* ============================================================================
 * TEMPORARY M0 STUB — the real Kubernetes simulation lands at M1.
 *
 * This file exists so that (a) the sim/world dependency boundary test has its
 * entry point from day one, and (b) main.ts can wire the fixed-step timebase
 * against a real update() signature. It advances a clock and nothing else.
 * It must never import three.js or src/world, and must never touch wall-clock
 * time or unseeded randomness — the boundary and determinism rules apply to
 * the stub exactly as they will to the model.
 *
 * M1 replaces the cast below with the real Kubernetes SimState contract in
 * src/core/types.ts (etcd, apiserver, scheduler, controllers, kubelets).
 * ==========================================================================*/
import type { Bus, SimState } from '../core/types'

export interface SimApi {
  state: SimState
  /** Called by the frame timebase once per fixed model step. */
  update: (dt: number) => void
  reset: () => void
}

export function createSim(_bus: Bus): SimApi {
  const state = {
    t: 0,
    knobs: { paused: false, timeScale: 1 },
  } as unknown as SimState

  return {
    state,
    update(dt: number): void {
      state.t += dt
    },
    reset(): void {
      state.t = 0
    },
  }
}
