/* Derived from PGSimCity test/trademark-notice.test.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: asserts the
 * Kubernetes/Linux Foundation notice instead of the Electronic Arts notice.
 * The help-overlay assertion returns when src/ui/help.ts is vendored (M2). */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { NO_FOREIGN_CONTENT, TRADEMARK_NOTICE } from '../src/ui/legal'

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
})
