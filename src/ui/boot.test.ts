import { describe, expect, it, vi } from 'vitest'
import {
  BOOT_STEPS,
  finishBoot,
  presentBootStep,
  waitForNextPaint,
  type BootSurface,
} from './boot'

function surface(): {
  value: BootSurface
  root: { classList: { add: ReturnType<typeof vi.fn> } }
  fill: { style: { width: string } }
  status: { style: { color: string }; textContent: string }
} {
  const root = { classList: { add: vi.fn() } }
  const fill = { style: { width: '' } }
  const status = { style: { color: '' }, textContent: '' }
  return {
    value: { root, fill, status } as unknown as BootSurface,
    root,
    fill,
    status,
  }
}

describe('boot progress', () => {
  it('crosses a paint boundary before construction resumes', async () => {
    const frames: (() => void)[] = []
    let resumed = false
    const pending = waitForNextPaint((callback) => frames.push(callback)).then(() => {
      resumed = true
    })

    expect(frames).toHaveLength(1)
    frames.shift()?.()
    await Promise.resolve()
    expect(resumed).toBe(false)
    expect(frames).toHaveLength(1)

    frames.shift()?.()
    await pending
    expect(resumed).toBe(true)
  })

  it('publishes monotonic construction milestones ending at the first frame', () => {
    const steps = Object.values(BOOT_STEPS)

    /* Kubetropolis M0 boot ladder; strictly increasing and ending at 100. */
    expect(steps.map((step) => step.pct)).toEqual([12, 26, 40, 58, 74, 88, 100])
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].pct, 'boot progress must be monotonic').toBeGreaterThan(steps[i - 1].pct)
    }
    expect(steps.at(-1)?.label).toBe('rendering the first frame…')
  })

  it('starts fading in the same update that reports ready', async () => {
    const boot = surface()
    await presentBootStep(boot.value, BOOT_STEPS.firstFrame, async () => {})
    expect(boot.fill.style.width).toBe('100%')
    expect(boot.status.textContent).toBe('rendering the first frame…')
    expect(boot.root.classList.add).not.toHaveBeenCalled()

    finishBoot(boot.value)
    expect(boot.status.textContent).toBe('ready')
    expect(boot.root.classList.add).toHaveBeenCalledWith('done')
  })
})
