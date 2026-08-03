/* Derived from PGSimCity src/ui/boot.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Modified for Kubetropolis: boot steps renamed for the
 * Kubernetes city; the presentation functions are unchanged. */

export interface BootStep {
  pct: number
  label: string
}

export const BOOT_STEPS = {
  renderer: { pct: 12, label: 'starting the renderer…' },
  camera: { pct: 26, label: 'placing the camera…' },
  simulation: { pct: 40, label: 'seeding the cluster ledger…' },
  ground: { pct: 58, label: 'grading the island…' },
  sky: { pct: 74, label: 'raising the sky…' },
  roads: { pct: 88, label: 'painting the roads…' },
  firstFrame: { pct: 100, label: 'rendering the first frame…' },
} as const satisfies Record<string, BootStep>

export type FrameScheduler = (callback: () => void) => void

/**
 * Resume only after the updated boot state has crossed a paint boundary.
 * Resolving inside one animation frame resumes its microtasks before paint.
 */
export function waitForNextPaint(
  schedule: FrameScheduler = (callback) => requestAnimationFrame(callback),
): Promise<void> {
  return new Promise((resolve) => schedule(() => schedule(resolve)))
}

export interface BootSurface {
  root: HTMLElement | null
  fill: HTMLElement | null
  status: HTMLElement | null
}

export function presentBootStep(
  surface: BootSurface,
  step: BootStep,
  wait: () => Promise<void> = waitForNextPaint,
): Promise<void> {
  if (surface.fill) surface.fill.style.width = `${step.pct}%`
  if (surface.status) surface.status.textContent = step.label
  return wait()
}

export function finishBoot(surface: BootSurface): void {
  if (surface.fill) surface.fill.style.width = '100%'
  if (surface.status) surface.status.textContent = 'ready'
  surface.root?.classList.add('done')
}

export function failBoot(surface: BootSurface, message: string): void {
  if (surface.status) {
    surface.status.textContent = message
    surface.status.style.color = 'var(--c-crit)'
  }
  if (surface.fill) surface.fill.style.background = 'var(--c-crit)'
}
