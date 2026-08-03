/* Structural honesty for the claims registry: unique ids, real sources (or an
 * explicit model note), non-empty statements — and the anti-rot rule from the
 * fidelity review (B9): a claim marked 'exact' must have a real consumer. Five
 * claims once said 'exact' for mechanisms the model did not implement; this
 * file is why that cannot happen again. Copy-level enforcement — every
 * displayed number resolving to a claim — arrives with the M3 trace. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CLAIM_BY_ID, CLAIMS } from '../src/core/claims'

function sourceOf(usedByPath: string): string | null {
  if (!usedByPath.includes('/')) return null // e.g. 'FIDELITY.md' pointers
  try {
    return readFileSync(
      fileURLToPath(new URL(`../src/${usedByPath}.ts`, import.meta.url)),
      'utf8',
    )
  } catch {
    return null
  }
}

describe('claims registry structure', () => {
  it('ids are unique and kebab/dot-cased', () => {
    expect(CLAIM_BY_ID.size).toBe(CLAIMS.length)
    for (const claim of CLAIMS) {
      expect(claim.id).toMatch(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/)
    }
  })

  it('every claim has a non-empty statement', () => {
    for (const claim of CLAIMS) {
      expect(claim.statement.trim().length, claim.id).toBeGreaterThan(20)
    }
  })

  it('exact claims cite https sources; modeled claims carry a model note', () => {
    for (const claim of CLAIMS) {
      if (claim.coverage === 'exact') {
        expect(claim.source, claim.id).toMatch(/^https:\/\//)
      } else {
        expect(Boolean(claim.source ?? claim.modelNote), claim.id).toBe(true)
      }
    }
  })

  it('every claim names at least one consuming surface', () => {
    for (const claim of CLAIMS) {
      expect(claim.usedBy.length, claim.id).toBeGreaterThan(0)
    }
  })

  it("an 'exact' claim has a REAL consumer of its CLAIM_VALUES group (B9 anti-rot)", () => {
    for (const claim of CLAIMS) {
      if (claim.coverage !== 'exact') continue
      if (claim.values !== undefined) {
        const hit = claim.usedBy.some((path) => {
          const src = sourceOf(path)
          return src !== null && src.includes(`CLAIM_VALUES.${claim.values}`)
        })
        expect(hit, `${claim.id}: no usedBy file reads CLAIM_VALUES.${claim.values}`).toBe(true)
      } else {
        // Behavior-only claims may skip `values` — but then the statement must
        // not smuggle in numbers that nothing enforces.
        expect(
          /\d{2,}/.test(claim.statement),
          `${claim.id}: numeric statement needs a values group`,
        ).toBe(false)
      }
    }
  })

  it("downgraded coverage always explains itself", () => {
    for (const claim of CLAIMS) {
      if (claim.coverage !== 'exact') {
        expect(Boolean(claim.modelNote), `${claim.id} needs a modelNote`).toBe(true)
      }
    }
  })
})
