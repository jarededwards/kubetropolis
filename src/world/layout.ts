/* Derived from PGSimCity src/world/layout.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Rewritten for Kubetropolis at M2: the Postgres city
 * is replaced wholesale by the Kubernetes city. The doctrine is unchanged and
 * non-negotiable: THIS FILE IS THE SINGLE OWNER OF GEOGRAPHY. Districts must
 * stay inside their footprint and read every shared position from ANCHOR /
 * the helpers below — never hard-code a coordinate another district needs.
 *
 * ==========================================================================
 *                              ▲ -Z  (north)
 *
 *                 CLIENT TERMINAL  z ≈ -296   (kubectl kiosk)
 *                 GATE             z ≈ -260
 *
 *   INSPECTORS          CITY HALL  z = -122..-74        ZONING OFFICE
 *   x = -132..-72       (kube-apiserver)                x = 77..127
 *   (controllers)       watch board on south face      map table south
 *                                                       INGRESS ramp NE
 *                 PLAZA + PIT  (origin)                 service junction
 *                 HALL OF RECORDS vault y = -14         x ≈ 178, z ≈ -40
 *                 (etcd, under a glass floor)
 *
 *   HARBOR (registry)   NODE-A      NODE-B      NODE-C
 *   quay x ≈ -292       x = -150    x = 0       x = 150     z = 68..168
 *   bay is real water   (kubelet districts: pads, substation, water tower)
 *   lighthouse on the
 *   breakwater (M7)     RESERVE PADS (dark)                 z = 200..304
 *
 *                              ▼ +Z  (south)
 * ==========================================================================*/
import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { RouteDef } from '../core/types'

/* --------------------------------------------------------------------------
 * CITY — the shared dimensional constants.
 * ------------------------------------------------------------------------*/

export const CITY = {
  /**
   * The excavation. The ground plane is cut away over this rectangle so the
   * Hall of Records below is visible from the surface — the plaza floats over
   * it on a glass/grate floor. Nothing that lives at y≈0 may be placed inside
   * these bounds.
   */
  pit: { x: 44, z: 34, wallDepth: 26 },
  /** The vault room under the pit (etcd). */
  vault: { y: -14, w: 64, d: 44 },
  /** City Hall (kube-apiserver). Footprint centred on `z`. */
  hall: { x: 0, z: -98, w: 72, d: 48, h: 30 },
  /** The civic plaza apron around the pit. */
  plaza: { w: 150, d: 96, cz: -30 },
  /** Node districts: three live columns, one live row + one reserve row. */
  node: {
    colX: [-150, 0, 150],
    rowZ: [120, 252],
    w: 118,
    d: 100,
    pads: { cols: 4, rows: 3, px: 25, pz: 22, x0: -37.5, z0: 2 },
  },
  /** The harbor: quay line, the bay water rectangle, sea level. */
  harbor: {
    quayX: -292,
    sea: { x0: -640, x1: -314, z0: -60, z1: 260 },
    waterY: -3.4,
  },
  /** how far the ground plane / grid extends */
  ground: 1400,
  /** fog */
  fog: { near: 220, far: 1150 },
} as const

/* --------------------------------------------------------------------------
 * Named anchors. `[x, y, z]`. Keys double as Registry component ids.
 * ------------------------------------------------------------------------*/

export const ANCHOR = {
  cityCenter: [0, 6, -30],
  'overview.balloon': [20, 175, -30],

  // gate & client terminal
  'client.terminal': [0, 0, -296],
  'gate.north': [0, 0, -260],

  // City Hall — kube-apiserver
  'cityhall.permitdesk': [0, 4, -98],
  'cityhall.plaza': [0, 0, -52],
  'cityhall.watchboard': [0, 16, -71],
  'cityhall.door.north': [0, 0, -124],
  'cityhall.door.south': [0, 0, -72],
  'cityhall.door.west': [-38, 0, -98],
  'cityhall.door.east': [38, 0, -98],

  // Hall of Records — etcd, in the pit
  'records.vault': [0, -14, 0],
  'records.compactor': [26, -14, 20],
  'records.stair': [-36, -2, -24],

  // Zoning Office — kube-scheduler
  'zoning.office': [102, 0, -98],
  'zoning.maptable': [102, 4, -62],

  // Office of Inspectors — controller manager
  'inspectors.office': [-102, 0, -98],
  'inspectors.desk.deployment': [-126, 3, -94],
  'inspectors.desk.replicaset': [-116.4, 3, -94],
  'inspectors.desk.endpointslice': [-106.8, 3, -94],
  'inspectors.desk.nodelifecycle': [-97.2, 3, -94],
  'inspectors.desk.hpa': [-87.6, 3, -94],
  'inspectors.desk.gc': [-78, 3, -94],

  // node districts — kubelets
  'node.a.gate': [-150, 0, 70],
  'node.a.foreman': [-184, 0, 78],
  'node.a.signage': [-164, 0, 72],
  'node.a.substation': [-194, 0, 106],
  'node.a.watertower': [-106, 0, 104],
  'node.b.gate': [0, 0, 70],
  'node.b.foreman': [-34, 0, 78],
  'node.b.signage': [-14, 0, 72],
  'node.b.substation': [-44, 0, 106],
  'node.b.watertower': [44, 0, 104],
  'node.c.gate': [150, 0, 70],
  'node.c.foreman': [116, 0, 78],
  'node.c.signage': [136, 0, 72],
  'node.c.substation': [106, 0, 106],
  'node.c.watertower': [194, 0, 104],

  // harbor — the image registry
  'harbor.docks': [-282, 0, 120],
  'harbor.crane': [-286, 0, 80],
  'harbor.registry': [-272, 0, 58],
  'harbor.ship': [-348, -2, 84],
  'harbor.lighthouse': [-486, 0, -14],
  'operator.shack': [-278, 0, 150],

  // ingress & services (built out at M6; anchors reserved now)
  'ingress.offramp': [252, 10, -186],
  'ingress.gantry': [214, 4, -128],
  'service.junction': [178, 0, -40],
  'service.directory': [178, 6, -40],

  // civic odds and ends (reserved)
  'quota.kiosk': [96, 0, 34],
  'events.newsstand': [56, 0, -36],
} as const satisfies Record<string, readonly [number, number, number]>

export type AnchorId = keyof typeof ANCHOR

export const v3 = (a: readonly [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2])
export const at = (id: AnchorId) => v3(ANCHOR[id])

/* --------------------------------------------------------------------------
 * Node helpers.
 * ------------------------------------------------------------------------*/

export const NODE_IDS = ['a', 'b', 'c'] as const
export type NodeLetter = (typeof NODE_IDS)[number]

/** Centre of a live node district (index 0..2 → node-a..c). */
export function nodeCenter(i: number): [number, number, number] {
  return [CITY.node.colX[i] ?? 0, 0, CITY.node.rowZ[0]]
}

/** Centre of a reserve (dark) pad district (index 0..2). */
export function reserveCenter(i: number): [number, number, number] {
  return [CITY.node.colX[i] ?? 0, 0, CITY.node.rowZ[1]]
}

/** World position of building pad `pad` (0..11) in live node `i` (0..2). */
export function nodePadPos(i: number, pad: number): [number, number, number] {
  const [cx, , cz] = nodeCenter(i)
  const p = CITY.node.pads
  const col = pad % p.cols
  const row = Math.floor(pad / p.cols)
  return [cx + p.x0 + col * p.px, 0, cz + p.z0 + row * p.pz]
}

/* --------------------------------------------------------------------------
 * ROUTES — the road network.
 *
 * Every animated packet in the city travels along one of these. Districts emit
 * onto a route by id; engine/flows.ts owns the particles. Routes whose
 * `visible` flag is set also get a faint physical "road" drawn along them.
 * ------------------------------------------------------------------------*/

const R: Record<string, RouteDef> = {}

function route(
  id: string,
  points: [number, number, number][],
  opts: Partial<Omit<RouteDef, 'id' | 'points'>> = {},
): RouteDef {
  const def: RouteDef = {
    id,
    points,
    color: opts.color ?? COLOR.watch,
    speed: opts.speed ?? 90,
    size: opts.size ?? 1.1,
    visible: opts.visible ?? false,
    roadOpacity: opts.roadOpacity ?? 0.16,
    tension: opts.tension ?? 0.5,
    linear: opts.linear ?? false,
  }
  R[id] = def
  return def
}

/* --- the apply path: kubectl → the permit desk → the vault ---------------- */

/** The arrivals avenue: terminal door → gate → City Hall's north door. */
route('apply.in', [
  [0, 2, -292],
  [0, 2, -262],
  [0, 2, -192],
  [0, 2, -126],
], { color: COLOR.client, speed: 70, visible: true, roadOpacity: 0.14, size: 1.4 })

/** A committed write: out the hall's south door, down the stair, into the vault. */
route('apply.commit', [
  [0, 2, -70],
  [0, 2, -46],
  [-24, 0, -30],
  [-30, -8, -16],
  [-8, -12, -2],
], { color: COLOR.etcd, speed: 80, size: 1.2 })

/* --- watch fan-out: the couriers -----------------------------------------
 * One commit, N couriers on N distinct roads. The operator's road hugs the
 * shoreline on purpose: it is the longest watch in the city, because an
 * operator is just a client far from the control plane. */

route('watch.sched', [
  [0, 14, -70],
  [26, 8, -64],
  [64, 4, -70],
  [98, 3, -80],
], { color: COLOR.watch, speed: 96 })

route('watch.inspect', [
  [0, 14, -70],
  [-30, 8, -64],
  [-66, 4, -72],
  [-98, 3, -86],
], { color: COLOR.watch, speed: 96 })

route('watch.kubelet.a', [
  [0, 14, -70],
  [-40, 6, -40],
  [-92, 3, 10],
  [-136, 2, 52],
  [-150, 2, 68],
], { color: COLOR.watch, speed: 100, visible: true })

route('watch.kubelet.b', [
  [0, 14, -70],
  [6, 6, -34],
  [4, 3, 20],
  [0, 2, 68],
], { color: COLOR.watch, speed: 100, visible: true })

route('watch.kubelet.c', [
  [0, 14, -70],
  [40, 6, -40],
  [92, 3, 10],
  [136, 2, 52],
  [150, 2, 68],
], { color: COLOR.watch, speed: 100, visible: true })

route('watch.operator', [
  [0, 14, -70],
  [-60, 6, -64],
  [-150, 3, -52],
  [-226, 2, -20],
  [-262, 2, 40],
  [-276, 2, 108],
  [-278, 2, 146],
], { color: COLOR.watch, speed: 100, visible: true, roadOpacity: 0.1 })

/* --- the loop back: desks write through the front door, always ----------- */

route('workorder.inspect', [
  [-102, 2, -80],
  [-72, 2, -66],
  [-42, 2, -84],
  [-36, 2, -96],
], { color: COLOR.civic, speed: 90, visible: true })

route('bind.zoning', [
  [102, 2, -80],
  [70, 2, -66],
  [42, 2, -84],
  [38, 2, -96],
], { color: COLOR.sched, speed: 90, visible: true })

/* --- harbor pull roads: images arrive as cargo ---------------------------- */

route('pull.a', [
  [-284, 2, 78],
  [-262, 2, 84],
  [-232, 2, 86],
  [-196, 2, 88],
  [-166, 2, 74],
  [-150, 2, 66],
], { color: COLOR.harbor, speed: 64, visible: true, size: 1.6 })

route('pull.b', [
  [-284, 2, 78],
  [-250, 2, 92],
  [-180, 2, 102],
  [-90, 2, 96],
  [-20, 2, 76],
  [0, 2, 66],
], { color: COLOR.harbor, speed: 64, visible: true, size: 1.6 })

route('pull.c', [
  [-284, 2, 78],
  [-240, 2, 100],
  [-120, 2, 110],
  [30, 2, 108],
  [120, 2, 84],
  [150, 2, 66],
], { color: COLOR.harbor, speed: 64, visible: true, size: 1.6 })

/* --- heartbeats: the foremen report in ------------------------------------ */

route('heartbeat.a', [
  [-150, 2, 64],
  [-120, 2, 20],
  [-60, 2, -30],
  [-8, 2, -60],
  [-4, 2, -70],
], { color: COLOR.kubelet, speed: 110, size: 0.9 })

route('heartbeat.b', [
  [0, 2, 64],
  [-2, 2, 10],
  [4, 2, -40],
  [2, 2, -70],
], { color: COLOR.kubelet, speed: 110, size: 0.9 })

route('heartbeat.c', [
  [150, 2, 64],
  [116, 2, 16],
  [56, 2, -32],
  [8, 2, -60],
  [4, 2, -70],
], { color: COLOR.kubelet, speed: 110, size: 0.9 })

/* --- reserved routes (M6/M7/M8 wire these) -------------------------------- */

route('evict.a', [
  [-150, 2.4, 62],
  [-118, 2.4, 18],
  [-58, 2.4, -32],
  [-6, 2.4, -62],
  [-2, 2.4, -72],
], { color: COLOR.warn, speed: 84, size: 1.1 })

route('evict.b', [
  [0, 2.4, 62],
  [0, 2.4, 8],
  [6, 2.4, -42],
  [4, 2.4, -72],
], { color: COLOR.warn, speed: 84, size: 1.1 })

route('evict.c', [
  [150, 2.4, 62],
  [114, 2.4, 14],
  [54, 2.4, -34],
  [6, 2.4, -62],
  [6, 2.4, -72],
], { color: COLOR.warn, speed: 84, size: 1.1 })

route('request.in', [
  [252, 10, -190],
  [224, 5, -140],
  [196, 2, -84],
  [178, 2, -44],
], { color: COLOR.client, speed: 96, visible: true, roadOpacity: 0.12 })

route('refuel', [
  [-282, 2, 116],
  [-288, 2, 36],
  [-320, 2, 6],
  [-400, 2, -4],
  [-480, 2, -14],
], { color: COLOR.crd, speed: 60, size: 1.4 })

export const ROUTES: Readonly<Record<string, RouteDef>> = R
export const ROUTE_IDS = Object.keys(R)

const curveCache = new Map<string, THREE.CatmullRomCurve3>()

/**
 * Memoised curve for a route. Districts can use this to move *meshes* along a
 * road (image flatbeds, the refuel truck) — not just particles.
 */
export function routeCurve(id: string): THREE.CatmullRomCurve3 | null {
  const cached = curveCache.get(id)
  if (cached) return cached
  const def = ROUTES[id]
  if (!def) {
    console.warn(`[layout] unknown route "${id}"`)
    return null
  }
  const curve = new THREE.CatmullRomCurve3(
    def.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    def.linear ? 'catmullrom' : 'catmullrom',
    def.tension ?? 0.5,
  )
  curveCache.set(id, curve)
  return curve
}

/** Convenience: point + tangent at t along a route. */
const _tmp = new THREE.Vector3()
export function routePoint(id: string, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = routeCurve(id)
  if (!c) return out.set(0, 0, 0)
  return c.getPointAt(Math.max(0, Math.min(1, t)), out)
}
export function routeTangent(id: string, t: number, out = _tmp): THREE.Vector3 {
  const c = routeCurve(id)
  if (!c) return out.set(0, 0, 1)
  return c.getTangentAt(Math.max(0, Math.min(1, t)), out)
}

/** Approximate arc length, cached by three's curve implementation. */
export function routeLength(id: string): number {
  const c = routeCurve(id)
  return c ? c.getLength() : 1
}

export interface Bounds {
  x: [number, number]
  z: [number, number]
}

/** Every district's bounding footprint — used by the minimap and by district dimming. */
export const DISTRICT_BOUNDS: Record<string, Bounds> = {
  gate: { x: [-48, 48], z: [-312, -238] },
  civic: { x: [-134, 134], z: [-126, -70] },
  records: { x: [-52, 52], z: [-42, 42] },
  zoning: { x: [77, 127], z: [-119, -56] },
  inspectors: { x: [-132, -72], z: [-119, -77] },
  'node-a': { x: [-209, -91], z: [68, 168] },
  'node-b': { x: [-59, 59], z: [68, 168] },
  'node-c': { x: [91, 209], z: [68, 168] },
  reserve: { x: [-209, 209], z: [200, 304] },
  harbor: { x: [-298, -260], z: [30, 158] },
  ingress: { x: [150, 262], z: [-198, -24] },
  world: { x: [-500, 500], z: [-500, 500] },
} as const satisfies Record<string, { x: readonly [number, number] | number[]; z: readonly [number, number] | number[] }>
