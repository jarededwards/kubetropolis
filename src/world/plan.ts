/* Derived from PGSimCity src/world/slonik.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Modified for Kubetropolis: the PostgreSQL elephant
 * outline (Daniel Lundin's artwork) is replaced with an original procedural
 * island outline; the generic ring math (sampling, containment, clearance,
 * offsetting) is kept verbatim. */
import * as THREE from 'three'
import { ANCHOR, DISTRICT_BOUNDS } from './layout'

/* ============================================================================
 * THE ISLAND — the shape of the ground Kubetropolis stands on.
 *
 * The city is not reshaped. What is shaped is the *plate*: the poured slab the
 * districts are bolted to ends in an organic coastline. Seen from orbit it
 * reads as an island in the void; seen straight down (the `O` preset) it reads
 * as a map with a harbor.
 *
 * The outline is original, hand-authored control-point data — no third-party
 * artwork, no marks. Its distinguishing features:
 *
 *   - slightly elongated north–south, matching the gate→districts axis
 *   - a concave HARBOR BAY on the west edge (the image registry's waterfront;
 *     bay water is outside the ring, so the plate genuinely ends there)
 *   - a small BREAKWATER SPIT hooking west at the bay's southern lip — the
 *     future lighthouse site (M7)
 *
 * Control points are converted to closed Catmull-Rom cubics at module load —
 * deterministic, no fetch, no parser. The audit at the bottom of this file
 * fails loudly if any district or continuity anchor ever sits within 8 m of
 * the coast (or in the water).
 * ==========================================================================*/

/**
 * Hand-authored coastline control points, world plan metres, wound clockwise
 * from the northern tip. Consumers never read these directly; they read the
 * sampled ring.
 */
const COAST_POINTS: readonly [number, number][] = [
  [30, -470],    // northern tip — the gate faces this way
  [270, -450],   // NE shoulder
  [415, -350],
  [430, -150],   // east coast
  [425, 70],
  [405, 250],
  [310, 400],    // SE
  [110, 455],    // south coast
  [-90, 450],
  [-265, 405],
  [-385, 310],   // SW rise toward the harbor
  [-436, 208],   // approach to the bay's southern mouth
  [-442, 156],   // bay mouth, southern lip
  [-348, 126],   // bay south shore, heading inland
  [-314, 96],    // bay head — the quay faces this water
  [-318, 52],    // bay head, northern half
  [-360, 24],    // bay north shore, heading back out
  [-438, 12],    // bay mouth, northern lip
  [-452, -2],    // breakwater root
  [-488, -14],   // breakwater tip — lighthouse site (M7)
  [-482, -30],   // breakwater outer face
  [-446, -36],   // rejoin the west coast
  [-452, -140],  // west coast running north
  [-451, -260],  // NW coast
  [-372, -365],
  [-215, -440],
]

/**
 * The world direction that belongs at the top of frame in the overview shot.
 * Kubetropolis is a north-up map: world north is -Z.
 */
export const PLAN_UP: readonly [number, number] = [0, -1]

/**
 * Normalised dressing space → world plan. Ground dressing uses this small,
 * source-independent coordinate frame; the plate itself uses the coastline.
 */
export function logoToWorld(xe: number, ye: number): [number, number] {
  const k = 5.3
  return [k * xe, k * ye]
}

/** One coastline segment in world plan coordinates. */
export type PlanCurve =
  | { readonly kind: 'line'; readonly to: [number, number] }
  | {
      readonly kind: 'cubic'
      readonly c1: [number, number]
      readonly c2: [number, number]
      readonly to: [number, number]
    }

/**
 * Closed Catmull-Rom spline through the control points, emitted as cubic
 * Béziers (tangent m_i = (P[i+1] − P[i−1]) / 2; c1 = P + m/3, c2 = Q − m'/3).
 * The final cubic lands exactly on the first point, so sampleOutline() takes
 * its closed-ring path.
 */
function coastCurves(points: readonly [number, number][]): {
  start: [number, number]
  curves: PlanCurve[]
} {
  const n = points.length
  const curves: PlanCurve[] = []
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    const m1: [number, number] = [(p2[0] - p0[0]) / 2, (p2[1] - p0[1]) / 2]
    const m2: [number, number] = [(p3[0] - p1[0]) / 2, (p3[1] - p1[1]) / 2]
    curves.push({
      kind: 'cubic',
      c1: [p1[0] + m1[0] / 3, p1[1] + m1[1] / 3],
      c2: [p2[0] - m2[0] / 3, p2[1] - m2[1] / 3],
      to: [p2[0], p2[1]],
    })
  }
  return { start: [points[0][0], points[0][1]], curves }
}

const coast = coastCurves(COAST_POINTS)

/** The outline as world-space segments, starting from `PLAN_START`. */
export const PLAN_START: [number, number] = coast.start
export const PLAN_CURVES: readonly PlanCurve[] = coast.curves

/* --------------------------------------------------------------------------
 * Sampling.
 * ------------------------------------------------------------------------*/

/**
 * The closed outline as a flat `[x0, z0, x1, z1, …]` ring in world plan
 * coordinates, `seg` samples per cubic. The start point is included once; the
 * ring is not repeated at the end.
 */
export function sampleOutline(seg = 16): Float64Array {
  const final = PLAN_CURVES[PLAN_CURVES.length - 1].to
  const closesItself = Math.hypot(final[0] - PLAN_START[0], final[1] - PLAN_START[1]) < 1e-7
  const pointCount = PLAN_CURVES.length * seg + (closesItself ? 0 : 1)
  const out = new Float64Array(pointCount * 2)
  let px = PLAN_START[0]
  let pz = PLAN_START[1]
  out[0] = px
  out[1] = pz
  let w = 2
  for (let ci = 0; ci < PLAN_CURVES.length; ci++) {
    const c = PLAN_CURVES[ci]
    // Do not duplicate the first point when the spline closes explicitly.
    const last = ci === PLAN_CURVES.length - 1 && closesItself ? seg - 1 : seg
    for (let i = 1; i <= last; i++) {
      const t = i / seg
      if (c.kind === 'line') {
        out[w++] = px + (c.to[0] - px) * t
        out[w++] = pz + (c.to[1] - pz) * t
      } else {
        const u = 1 - t
        const a = u * u * u
        const b = 3 * u * u * t
        const d = 3 * u * t * t
        const e = t * t * t
        out[w++] = a * px + b * c.c1[0] + d * c.c2[0] + e * c.to[0]
        out[w++] = a * pz + b * c.c1[1] + d * c.c2[1] + e * c.to[1]
      }
    }
    px = c.to[0]
    pz = c.to[1]
  }
  return out
}

/** Axis-aligned world extent of the plate. */
export interface PlanBounds {
  x0: number
  x1: number
  z0: number
  z1: number
}

export function outlineBounds(ring: Float64Array): PlanBounds {
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (let i = 0; i < ring.length; i += 2) {
    const x = ring[i]
    const z = ring[i + 1]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (z < z0) z0 = z
    if (z > z1) z1 = z
  }
  return { x0, x1, z0, z1 }
}

/** Signed doubled area. Positive means counter-clockwise in (x, z). */
export function ringArea2(ring: Float64Array): number {
  let a = 0
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1]
  }
  return a
}

/* --------------------------------------------------------------------------
 * Queries. Used by the containment check and by the edge-distance field.
 * ------------------------------------------------------------------------*/

/** Crossing-number test against a sampled ring. */
export function contains(ring: Float64Array, x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const zi = ring[i + 1]
    const zj = ring[j + 1]
    if (zi > z !== zj > z) {
      const t = (z - zi) / (zj - zi)
      if (x < ring[i] + t * (ring[j] - ring[i])) inside = !inside
    }
  }
  return inside
}

/** Unsigned distance from (x, z) to the outline, in metres. */
export function distanceToEdge(ring: Float64Array, x: number, z: number): number {
  let best = Infinity
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j]
    const az = ring[j + 1]
    const dx = ring[i] - ax
    const dz = ring[i + 1] - az
    const l2 = dx * dx + dz * dz
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const ex = x - (ax + t * dx)
    const ez = z - (az + t * dz)
    const d = ex * ex + ez * ez
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/** Positive inside the plate, negative outside. Metres. */
export function clearance(ring: Float64Array, x: number, z: number): number {
  const d = distanceToEdge(ring, x, z)
  return contains(ring, x, z) ? d : -d
}

/**
 * Smallest clearance anywhere on the perimeter of an axis-aligned district
 * footprint. Negative means part of the district hangs over the void.
 */
export function rectClearance(
  ring: Float64Array,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  samples = 24,
): number {
  let worst = Infinity
  for (let i = 0; i <= samples; i++) {
    const f = i / samples
    const x = x0 + (x1 - x0) * f
    const z = z0 + (z1 - z0) * f
    worst = Math.min(
      worst,
      clearance(ring, x, z0),
      clearance(ring, x, z1),
      clearance(ring, x0, z),
      clearance(ring, x1, z),
    )
  }
  return worst
}

/* --------------------------------------------------------------------------
 * Static containment audit.
 * ------------------------------------------------------------------------*/

/** Eight metres keeps district plinths comfortably inside the 2.2 m kerb. */
const REQUIRED_CLEARANCE = 8
/** Land anchors that sit near the coast and must never end up in the water.
 * `harbor.ship` (moored in the bay) and `harbor.lighthouse` (on the narrow
 * breakwater spit, deliberately tighter than 8 m of land) are excluded. */
const AUDIT_ANCHORS = [
  'client.terminal',
  'gate.north',
  'harbor.docks',
  'harbor.crane',
  'harbor.registry',
  'operator.shack',
  'ingress.offramp',
  'quota.kiosk',
] as const

export interface IslandContainmentAudit {
  readonly requiredClearance: number
  readonly union: PlanBounds
  readonly districtMinimum: number
  readonly districtAtMinimum: string
  readonly anchorMinimum: number
  readonly anchorAtMinimum: (typeof AUDIT_ANCHORS)[number]
}

/**
 * Verify the live layout, not a stale hand-copied box. `world` is intentionally
 * excluded: layout.ts defines it as the whole minimap, not a physical district.
 * This runs once when the static world module loads and fails loudly if layout
 * changes ever push a district or continuity work over the kerb.
 * (The anchor list is the vendored Postgres layout's; it is replaced wholesale
 * with the Kubetropolis geography at M2.)
 */
function auditContainment(): IslandContainmentAudit {
  const ring = sampleOutline(48)
  const union: PlanBounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
  let districtMinimum = Infinity
  let districtAtMinimum = ''

  for (const [id, bounds] of Object.entries(DISTRICT_BOUNDS)) {
    if (id === 'world') continue
    union.x0 = Math.min(union.x0, bounds.x[0])
    union.x1 = Math.max(union.x1, bounds.x[1])
    union.z0 = Math.min(union.z0, bounds.z[0])
    union.z1 = Math.max(union.z1, bounds.z[1])
    const c = rectClearance(ring, bounds.x[0], bounds.x[1], bounds.z[0], bounds.z[1], 96)
    if (c < districtMinimum) {
      districtMinimum = c
      districtAtMinimum = id
    }
  }

  let anchorMinimum = Infinity
  let anchorAtMinimum: (typeof AUDIT_ANCHORS)[number] = AUDIT_ANCHORS[0]
  for (const id of AUDIT_ANCHORS) {
    const [x, , z] = ANCHOR[id]
    union.x0 = Math.min(union.x0, x)
    union.x1 = Math.max(union.x1, x)
    union.z0 = Math.min(union.z0, z)
    union.z1 = Math.max(union.z1, z)
    const c = clearance(ring, x, z)
    if (c < anchorMinimum) {
      anchorMinimum = c
      anchorAtMinimum = id
    }
  }

  if (districtMinimum < REQUIRED_CLEARANCE || anchorMinimum < REQUIRED_CLEARANCE) {
    throw new Error(
      `Island containment failed: district ${districtAtMinimum}=${districtMinimum.toFixed(2)} m, ` +
        `anchor ${anchorAtMinimum}=${anchorMinimum.toFixed(2)} m; required ${REQUIRED_CLEARANCE} m`,
    )
  }

  return {
    requiredClearance: REQUIRED_CLEARANCE,
    union,
    districtMinimum,
    districtAtMinimum,
    anchorMinimum,
    anchorAtMinimum,
  }
}

export const ISLAND_CONTAINMENT = auditContainment()

/* --------------------------------------------------------------------------
 * Geometry helpers.
 * ------------------------------------------------------------------------*/

/**
 * Lay the outline into a THREE.Shape. Shape space is XY and the plate is laid
 * down with a -90° rotation about X, so shape Y is world -Z.
 */
export function writeShape(shape: THREE.Shape): void {
  shape.moveTo(PLAN_START[0], -PLAN_START[1])
  for (const c of PLAN_CURVES) {
    if (c.kind === 'line') {
      shape.lineTo(c.to[0], -c.to[1])
    } else {
      shape.bezierCurveTo(c.c1[0], -c.c1[1], c.c2[0], -c.c2[1], c.to[0], -c.to[1])
    }
  }
  shape.closePath()
}

/**
 * Offset a ring inward by `d` metres, as a new flat ring. Vertex normals are
 * the average of the two adjacent edge normals, which is exact for a straight
 * run and good enough for a curve sampled this finely. `ccw` must say which way
 * the ring winds so "inward" means inward.
 */
export function offsetRing(ring: Float64Array, d: number, ccw: boolean): Float64Array {
  const n = ring.length / 2
  const out = new Float64Array(ring.length)
  const s = ccw ? 1 : -1
  for (let i = 0; i < n; i++) {
    const p = i * 2
    const prev = ((i - 1 + n) % n) * 2
    const next = ((i + 1) % n) * 2
    // Rotating an edge by +90° points inward for a ring that winds CCW in (x, z).
    let nx = 0
    let nz = 0
    for (let e = 0; e < 2; e++) {
      const a = e === 0 ? prev : p
      const b = e === 0 ? p : next
      const ex = ring[b] - ring[a]
      const ez = ring[b + 1] - ring[a + 1]
      const l = Math.hypot(ex, ez) || 1
      nx += (-ez / l) * s
      nz += (ex / l) * s
    }
    const l = Math.hypot(nx, nz) || 1
    out[p] = ring[p] + (nx / l) * d
    out[p + 1] = ring[p + 1] + (nz / l) * d
  }
  return out
}
