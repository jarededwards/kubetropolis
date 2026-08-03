/* Derived from PGSimCity test/trademark-notice.test.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: asserts the
 * Kubernetes/Linux Foundation notice instead of the Electronic Arts notice,
 * in both the boot markup and the help attribution surface. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { createBus } from '../src/core/bus'
import { createSim } from '../src/sim/model'
import { createHelp } from '../src/ui/help'
import type { UiContext } from '../src/ui/uikit'
import { NO_FOREIGN_CONTENT, TRADEMARK_NOTICE } from '../src/ui/legal'
import { installTestDom } from './dom'

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

describe('Kubernetes trademark notice', () => {
  it('stays in the boot markup', () => {
    const index = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
    expect(normalize(index)).toContain(normalize(TRADEMARK_NOTICE))
  })

  it('never lets the meta description drop the independence disclaimer', () => {
    const index = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')
    expect(normalize(index)).toContain('Not affiliated with The Linux Foundation or CNCF')
  })

  it('keeps the no-foreign-content statement intact', () => {
    expect(NO_FOREIGN_CONTENT).toContain('does not use the Kubernetes logo')
    expect(NO_FOREIGN_CONTENT).toContain('no SimCity code')
  })

  it('renders verbatim in the help attribution surface', () => {
    const dom = installTestDom()
    const root = dom.mount('help-overlay')
    const bus = createBus()
    const ctx: UiContext = {
      bus,
      sim: createSim(bus),
      registry: { all: () => [], get: () => undefined, search: () => [] } as unknown as UiContext['registry'],
      getFps: () => 60,
      getQuality: () => ({
        level: 'high',
        pixelRatio: 1,
        bloom: true,
        shadows: true,
        maxParticles: 1,
        maxLabels: 1,
        antialias: true,
      }),
      getFlowStats: () => ({ active: 0, dropped: 0 }),
    }
    const help = createHelp(ctx)
    expect(normalize(root.textContent ?? '')).toContain(normalize(TRADEMARK_NOTICE))
    help.dispose()
  })
})
