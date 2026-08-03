/* Structural honesty for the claims registry: unique ids, real sources (or an
 * explicit model note), non-empty statements. Copy-level enforcement — every
 * displayed number resolving to a claim — arrives with the M3 trace. */

import { describe, expect, it } from 'vitest'

import { CLAIM_BY_ID, CLAIMS } from '../src/core/claims'

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
})
