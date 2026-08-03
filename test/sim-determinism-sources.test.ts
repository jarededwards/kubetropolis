/* Determinism at the source level: the model may not read wall clocks,
 * schedule real timers, or draw unseeded randomness. CLAUDE.md makes this
 * non-negotiable; this test makes it mechanical. */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SIM_ROOT = fileURLToPath(new URL('../src/sim', import.meta.url))

const BANNED = [
  /\bDate\.now\b/,
  /\bMath\.random\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bperformance\.now\b/,
  /\brequestAnimationFrame\b/,
  /\bnew Date\b/,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('src/sim source discipline', () => {
  it('contains no wall-clock, timer, or unseeded-randomness sources', () => {
    const offenders: string[] = []
    for (const file of walk(SIM_ROOT)) {
      const text = readFileSync(file, 'utf8')
      for (const pattern of BANNED) {
        if (pattern.test(text)) offenders.push(`${file} → ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
