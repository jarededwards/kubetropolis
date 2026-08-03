/* Derived from PGSimCity src/core/timebase.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Modified for Kubetropolis (fidelity finding A2):
 * timeScale now varies the NUMBER of fixed steps consumed per frame — never
 * the step size. Per-tick budgets (admission stages, scheduler cycles,
 * controller keys) are therefore invariant in MODEL time across playback
 * speeds: the same script reaches the same state at 0.05× and at 4×. The M3
 * slow-motion trace depends on exactly this.
 */

/** The renderer and animated world never consume more than this per frame. */
export const MAX_VISUAL_DELTA_SECONDS = 0.1
/**
 * A two-second frame is possible on the software renderer. Larger gaps are
 * treated as stalls; THREE.Timer separately drops hidden-tab time through the
 * Page Visibility API.
 */
export const MAX_WALL_DELTA_SECONDS = 2
export const MODEL_STEP_SECONDS = 1 / 30
/** Runaway guard: a stalled frame at high timeScale must not spiral. */
const MAX_STEPS_PER_ADVANCE = 900

type ModelUpdate = (dt: number) => void

export function wallDelta(rawDt: number): number {
  if (!Number.isFinite(rawDt) || rawDt <= 0) return 0
  return Math.min(rawDt, MAX_WALL_DELTA_SECONDS)
}

export function simulationAnimationDelta(
  animationDt: number,
  paused: boolean,
  timeScale: number,
): number {
  return paused ? 0 : animationDt * timeScale
}

/**
 * Keep model time synchronized to SCALED wall time without giving one slow
 * update to the model: accumulate elapsed×timeScale as a model-time backlog
 * and consume it in fixed MODEL_STEP_SECONDS bites. Pausing drops the
 * fractional backlog immediately.
 */
export function createFrameTimebase(updateModel: ModelUpdate): {
  advance(elapsed: number, paused: boolean, timeScale: number): number
} {
  let remainder = 0

  return {
    advance(elapsed: number, paused: boolean, timeScale: number): number {
      if (paused) {
        remainder = 0
        return 0
      }

      remainder += elapsed * timeScale
      let steps = Math.floor((remainder + MODEL_STEP_SECONDS * 1e-9) / MODEL_STEP_SECONDS)
      if (steps > MAX_STEPS_PER_ADVANCE) {
        steps = MAX_STEPS_PER_ADVANCE
        remainder = 0
      } else {
        remainder -= steps * MODEL_STEP_SECONDS
        if (Math.abs(remainder) < MODEL_STEP_SECONDS * 1e-9) remainder = 0
      }
      for (let index = 0; index < steps; index++) {
        updateModel(MODEL_STEP_SECONDS)
      }
      return steps * MODEL_STEP_SECONDS
    },
  }
}
