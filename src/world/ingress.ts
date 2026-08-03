import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState, WorldContext, WorldModule } from '../core/types'
import { fmtNum } from '../core/util'
import { ANCHOR } from './layout'

/* ============================================================================
 * INGRESS & THE SERVICE JUNCTION — where citizens meet the directory.
 *
 * Callers pour off the coast highway, under the gantry that names the place
 * they asked for, and around the junction. At its centre stands the directory
 * board — the EndpointSlice, rendered as civic signage: the current edition,
 * how many doors it lists open, and how far each district's own signage lags
 * behind it. The lag rows are the delete-race lesson, posted in public.
 * ==========================================================================*/

export function createIngress(ctx: WorldContext): WorldModule {
  const { theme } = ctx
  const group = new THREE.Group()
  group.name = 'world.ingress'

  const off = ANCHOR['ingress.offramp']
  const gan = ANCHOR['ingress.gantry']
  const jn = ANCHOR['service.junction']

  /* --- the off-ramp: an elevated spur descending from the coast ----------- */
  const rampSegs: Array<[number, number, number, number]> = [
    // x, y, z, yaw — following the request.in polyline down
    [off[0], 9.2, off[2] + 2, -0.5],
    [238, 7, -166, -0.55],
    [224, 4.6, -141, -0.6],
    [210, 2.6, -113, -0.62],
    [196, 1.4, -85, -0.6],
  ]
  for (const [x, y, z, yaw] of rampSegs) {
    const seg = new THREE.Mesh(theme.box(10, 1.2, 34), theme.mat('grid'))
    seg.position.set(x, y, z)
    seg.rotation.y = yaw
    group.add(seg)
    const rail = new THREE.Mesh(theme.box(0.6, 1.4, 34), theme.mat('ink'))
    rail.position.set(x - 5, y + 1.2, z)
    rail.rotation.y = yaw
    group.add(rail)
  }
  // piers under the high segments
  for (const [x, y, z] of rampSegs.slice(0, 3)) {
    const pier = new THREE.Mesh(theme.box(2.2, y, 2.2), theme.mat('ink'))
    pier.position.set(x, y / 2 - 0.6, z)
    group.add(pier)
  }

  /* --- the gantry: the hostname, posted over the road ---------------------- */
  const legGeo = theme.box(1.4, 12, 1.4)
  for (const dx of [-9, 9]) {
    const leg = new THREE.Mesh(legGeo, theme.mat('ink'))
    leg.position.set(gan[0] + dx, 6, gan[2])
    group.add(leg)
  }
  const beam = new THREE.Mesh(theme.box(20, 2.6, 1.2), theme.mat('ink'))
  beam.position.set(gan[0], 11.4, gan[2])
  group.add(beam)
  const gantrySign = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 2.2),
    new THREE.MeshBasicMaterial({
      map: theme.textTexture('shop.city.example → shopfront', { size: 40, color: 'client' }),
      transparent: true,
    }),
  )
  gantrySign.position.set(gan[0], 11.5, gan[2] + 0.8)
  group.add(gantrySign)

  /* --- the junction: a roundabout with the directory at its centre --------- */
  const ring = new THREE.Mesh(new THREE.TorusGeometry(16, 1.4, 8, 40), theme.mat('grid'))
  ring.rotation.x = Math.PI / 2
  ring.position.set(jn[0], 0.5, jn[2])
  group.add(ring)
  const island = new THREE.Mesh(theme.cyl(7, 7.6, 1.2, 24), theme.mat('ink'))
  island.position.set(jn[0], 0.6, jn[2])
  group.add(island)

  // the directory board: pylon + double-sided canvas panel, redrawn on change
  const pylon = new THREE.Mesh(theme.box(1.2, 9, 1.2), theme.mat('ink'))
  pylon.position.set(jn[0], 4.5, jn[2])
  group.add(pylon)
  const boardMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide })
  const board = new THREE.Mesh(new THREE.PlaneGeometry(15, 7), boardMat)
  board.position.set(jn[0], 10.6, jn[2])
  group.add(board)
  const boardBack = board.clone()
  boardBack.rotation.y = Math.PI
  group.add(boardBack)

  let lastBoardKey = ''
  let boardAcc = 1e9 // draw on the first update
  function redrawBoard(s: SimState): void {
    const slice = s.vitals
    const rows: string[] = [
      `DIRECTORY  ·  edition ${slice.sliceGeneration}`,
      slice.sliceGeneration === 0
        ? 'no number to dial — apply a Service'
        : `${slice.readyEndpoints} doors listed open`,
    ]
    if (slice.sliceGeneration > 0) {
      for (const n of s.nodes) {
        const lag = n.proxy.endpoints.filter((e) => e.conditions.ready).length
        rows.push(`${n.id} signage sees ${lag} open · ed.rev ${n.proxy.programmedRev}`)
      }
    }
    const key = rows.join('|')
    if (key === lastBoardKey) return
    lastBoardKey = key
    boardMat.map?.dispose()
    boardMat.map = theme.textTexture(rows.join('\n'), { size: 30, color: 'client', bg: 'rgba(6,10,18,0.85)' })
    boardMat.needsUpdate = true
  }

  /* --- components ----------------------------------------------------------*/

  ctx.register({
    id: 'ingress.offramp',
    name: 'Ingress off-ramp',
    role: 'network — where named traffic enters',
    kind: 'network',
    district: 'ingress',
    object: group,
    tier: 1,
    focus: { target: [gan[0], 8, gan[2]], distance: 70, dir: [0.5, 0.4, -0.75] },
    color: COLOR.client,
    readout: (s: SimState) =>
      s.vitals.sliceGeneration === 0
        ? `${fmtNum(s.traffic.idleNoService, 0)} callers idle — no number to dial`
        : `${fmtNum(s.traffic.reqPerSec, 0)} callers/s inbound`,
  })

  ctx.register({
    id: 'service.junction',
    name: 'Service junction',
    role: 'network — round-robin over listed doors',
    kind: 'network',
    district: 'ingress',
    object: island,
    tier: 0,
    focus: { target: [jn[0], 4, jn[2]], distance: 84, dir: [0.35, 0.5, -0.75] },
    color: COLOR.client,
    readout: (s: SimState) =>
      `${fmtNum(s.vitals.reqServedTotal, 0)} served · ${fmtNum(s.vitals.reqMisroutedTotal, 0)} misrouted · ${fmtNum(s.vitals.reqRefusedTotal, 0)} refused`,
  })

  ctx.register({
    id: 'service.directory',
    name: 'Directory board (EndpointSlice)',
    role: 'network — the listing every signage copies',
    kind: 'network',
    district: 'ingress',
    object: board,
    tier: 1,
    labelAt: [jn[0], 15, jn[2]],
    focus: { target: [jn[0], 9, jn[2]], distance: 46, dir: [0.15, 0.34, -0.93] },
    color: COLOR.watch,
    readout: (s: SimState) =>
      s.vitals.sliceGeneration === 0
        ? 'no Service — nothing listed'
        : `edition ${s.vitals.sliceGeneration} · ${s.vitals.readyEndpoints} ready`,
  })

  /* --- update ---------------------------------------------------------------*/

  function update(dt: number, s: SimState, _t: number): void {
    boardAcc += dt
    if (boardAcc >= 0.5) {
      boardAcc = 0
      redrawBoard(s)
    }
  }

  return { id: 'ingress', group, update }
}
