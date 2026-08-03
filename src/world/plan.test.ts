/* Derived from PGSimCity src/world/slonik.test.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: the elephant-artwork
 * assertions (byte-pinned SVG path, trunk fraction, silhouette area) are
 * replaced with invariants for the original procedural island outline; the
 * containment-audit discipline is kept. */
import { describe, expect, it } from 'vitest'

import {
  ISLAND_CONTAINMENT,
  PLAN_CURVES,
  PLAN_START,
  PLAN_UP,
  clearance,
  contains,
  outlineBounds,
  rectClearance,
  ringArea2,
  sampleOutline,
} from './plan'
import { DISTRICT_BOUNDS } from './layout'

describe('Kubetropolis island outline', () => {
  it('is one closed spline that lands exactly on its start', () => {
    const final = PLAN_CURVES[PLAN_CURVES.length - 1].to
    expect(final[0]).toBe(PLAN_START[0])
    expect(final[1]).toBe(PLAN_START[1])
  })

  it('samples to a clean ring with no duplicate vertices', () => {
    const ring = sampleOutline(48)
    expect(ring.length).toBe(PLAN_CURVES.length * 48 * 2)
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length
      const d = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1])
      expect(d, `vertices ${i / 2} and ${j / 2} coincide`).toBeGreaterThan(1e-6)
    }
    expect(Math.abs(ringArea2(ring)) / 2).toBeGreaterThan(400_000) // m² — a real island, not a sliver
  })

  it('never self-intersects', () => {
    const ring = sampleOutline(24)
    const n = ring.length / 2
    const seg = (i: number) => {
      const j = (i + 1) % n
      return [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]] as const
    }
    const crosses = (
      ax: number, az: number, bx: number, bz: number,
      cx: number, cz: number, dx: number, dz: number,
    ): boolean => {
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
      const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax)
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx)
      const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx)
      return d1 * d2 < 0 && d3 * d4 < 0
    }
    for (let i = 0; i < n; i++) {
      for (let k = i + 2; k < n; k++) {
        if (i === 0 && k === n - 1) continue // adjacent around the seam
        const [ax, az, bx, bz] = seg(i)
        const [cx, cz, dx, dz] = seg(k)
        expect(
          crosses(ax, az, bx, bz, cx, cz, dx, dz),
          `segments ${i} and ${k} cross`,
        ).toBe(false)
      }
    }
  })

  it('is slightly elongated north–south and stays in its surveyed envelope', () => {
    const b = outlineBounds(sampleOutline(48))
    expect(b.z1 - b.z0).toBeGreaterThan(b.x1 - b.x0)
    expect(b.x0).toBeGreaterThan(-500)
    expect(b.x1).toBeLessThan(445)
    expect(b.z0).toBeGreaterThan(-485)
    expect(b.z1).toBeLessThan(470)
  })

  it('carves a real harbor bay on the west edge', () => {
    const ring = sampleOutline(48)
    // Same longitude, two latitudes: land south of the bay, water inside it.
    expect(contains(ring, -425, 100), 'coast south of the bay is land').toBe(true)
    expect(contains(ring, -425, -90), 'the bay itself is water').toBe(false)
    expect(clearance(ring, -425, -90), 'bay water is genuinely offshore').toBeLessThan(-5)
    // The breakwater spit reaches further west than the bay head.
    const b = outlineBounds(ring)
    expect(b.x0, 'spit tip is the westernmost land').toBeLessThan(-470)
  })

  it('keeps the overview north-up', () => {
    expect(PLAN_UP[0]).toBe(0)
    expect(PLAN_UP[1]).toBe(-1)
  })

  it('clears every district and continuity anchor by the kerb margin', () => {
    const ring = sampleOutline(48)
    for (const [id, bounds] of Object.entries(DISTRICT_BOUNDS)) {
      if (id === 'world') continue
      const margin = rectClearance(ring, bounds.x[0], bounds.x[1], bounds.z[0], bounds.z[1], 96)
      expect(margin, `${id} must clear the kerb margin`).toBeGreaterThanOrEqual(
        ISLAND_CONTAINMENT.requiredClearance,
      )
    }
    expect(ISLAND_CONTAINMENT.requiredClearance).toBe(8)
    expect(ISLAND_CONTAINMENT.districtMinimum).toBeGreaterThanOrEqual(8)
    expect(ISLAND_CONTAINMENT.anchorMinimum).toBeGreaterThanOrEqual(8)
    /* Exact per-district pins return at M2 when layout.ts becomes the
     * Kubetropolis geography; pinning the vendored Postgres layout's numbers
     * would only make replacing it noisier. */
  })
})
