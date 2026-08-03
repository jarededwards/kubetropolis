import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState, WatchReg, WorldContext, WorldModule } from '../core/types'
import { clamp01, fmtNum } from '../core/util'
import { ANCHOR, CITY, at } from './layout'
import { writeShape } from './plan'

/* ============================================================================
 * THE CIVIC DISTRICT — the entire control plane, one campus.
 *
 * CITY HALL      kube-apiserver. Every instruction in the city, human or
 *                machine, passes its permit desk. The four counters stamp what
 *                you did not write (AUTHN → MUTATE → QUOTA → VALIDATE).
 * WATCH BOARD    the split-flap departure board on the south facade. One row
 *                per subscriber; the lit tiles are how far that office's
 *                courier lags the vault. This board is what "informer" means.
 * HALL OF RECORDS  etcd. Three chambers under the plaza glass; the lit desk is
 *                the leader; the ledger conveyor advances one tile per
 *                committed revision; the furnace burns compacted history.
 * ZONING OFFICE  kube-scheduler, with the map table: a miniature of the whole
 *                island on which placement is decided.
 * INSPECTORS     the controller manager's desks. A desk owns a workqueue
 *                (paper piles up in courier deliveries), a lamp (lit while
 *                reconciling), and an outbox that leads back to the permit
 *                desk — a desk never touches a district directly.
 * ==========================================================================*/

/* --- module scratch: update() allocates nothing ---------------------------- */
const _c = new THREE.Color()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)

const BOARD_ROWS = 8
const BOARD_COLS = 12
const DESKS = ['deployment', 'replicaset', 'endpointslice', 'nodelifecycle', 'hpa', 'gc'] as const
const QUEUE_CAP = 8
const CONVEYOR_TILES = 22

/** Stable board row order; kubelet rows collapse onto their node letter. */
const BOARD_SUBSCRIBERS = [
  'sched',
  'ctl.deployment',
  'ctl.replicaset',
  'ctl.nodelifecycle',
  'kubelet.node-a',
  'kubelet.node-b',
  'kubelet.node-c',
  'operator',
] as const

function watcherFor(s: SimState, subscriber: string): WatchReg | null {
  const w = s.api.watchers
  for (let i = 0; i < w.length; i++) if (w[i].subscriber === subscriber) return w[i]
  return null
}

export function createControlPlane(ctx: WorldContext): WorldModule {
  const { theme } = ctx
  const group = new THREE.Group()
  group.name = 'world.control-plane'

  const disposables: { dispose(): void }[] = []
  const own = <T extends { dispose(): void }>(g: T): T => {
    disposables.push(g)
    return g
  }

  /* =========================================================================
   * CITY HALL
   * =======================================================================*/
  const hall = new THREE.Group()
  hall.name = 'cityhall'
  group.add(hall)

  const H = CITY.hall
  const mass = new THREE.Mesh(theme.box(H.w, H.h, H.d), theme.mat('civic'))
  mass.position.set(H.x, H.h / 2, H.z)
  hall.add(mass)

  // stepped crown + roof lantern (structure, not a mark)
  const crown = new THREE.Mesh(theme.box(H.w * 0.62, 6, H.d * 0.62), theme.mat('civic'))
  crown.position.set(H.x, H.h + 3, H.z)
  hall.add(crown)
  const lantern = new THREE.Mesh(theme.box(3, 5, 3), theme.neon(COLOR.civic, 1.1))
  lantern.position.set(H.x, H.h + 8.5, H.z)
  hall.add(lantern)

  // portico: six columns along the south face — the door every road leads to
  const colGeo = theme.cyl(1.1, 1.3, 12, 10)
  const columns = new THREE.InstancedMesh(colGeo, theme.mat('ink'), 6)
  for (let i = 0; i < 6; i++) {
    _p.set(H.x - 15 + i * 6, 6, H.z + H.d / 2 + 2.6)
    _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
    columns.setMatrixAt(i, _m)
  }
  columns.instanceMatrix.needsUpdate = true
  hall.add(columns)

  // door insets, north (arrivals) and south (plaza)
  const doorMat = theme.neon(COLOR.client, 0.55)
  for (const z of [H.z - H.d / 2 - 0.1, H.z + H.d / 2 + 0.1]) {
    const door = new THREE.Mesh(theme.box(6.5, 9, 0.8), doorMat)
    door.position.set(H.x, 4.5, z)
    hall.add(door)
  }

  // the four counters, engraved over the north approach so the apply street
  // reads them in order on the way in
  const counters = ['AUTHN', 'MUTATE', 'QUOTA', 'VALIDATE']
  for (let i = 0; i < counters.length; i++) {
    const tex = theme.textTexture(counters[i], { size: 46, color: 'ink' })
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 2.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    )
    sign.rotation.x = -Math.PI / 2
    sign.position.set(H.x - 10.5 + i * 7, 0.06, H.z - H.d / 2 - 6)
    sign.raycast = () => {}
    hall.add(sign)
    own(sign.geometry)
    own(sign.material as THREE.Material)
  }

  /* --- the watch board ---------------------------------------------------- */
  const board = new THREE.Group()
  board.name = 'cityhall.watchboard'
  const bAt = ANCHOR['cityhall.watchboard']
  board.position.set(bAt[0], bAt[1], bAt[2] + 0.6)
  hall.add(board)

  const boardBack = new THREE.Mesh(theme.box(26, 12, 1), theme.mat('ink'))
  board.add(boardBack)

  const tileGeo = theme.box(1.5, 1.05, 0.3)
  const tiles = new THREE.InstancedMesh(tileGeo, theme.mat('ink'), BOARD_ROWS * BOARD_COLS)
  tiles.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(BOARD_ROWS * BOARD_COLS * 3),
    3,
  )
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      _p.set(-9.6 + col * 1.75, 4.6 - r * 1.32, 0.75)
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
      tiles.setMatrixAt(r * BOARD_COLS + col, _m)
    }
  }
  tiles.instanceMatrix.needsUpdate = true
  board.add(tiles)

  /* =========================================================================
   * HALL OF RECORDS — down in the pit
   * =======================================================================*/
  const vault = new THREE.Group()
  vault.name = 'records.vault'
  group.add(vault)

  const vy = CITY.vault.y
  const floor = new THREE.Mesh(theme.box(CITY.vault.w, 1.2, CITY.vault.d), theme.mat('ground'))
  floor.position.set(0, vy - 0.6, 0)
  vault.add(floor)

  // three chambers; the leader's desk lamp is lit
  const chamberGeo = theme.box(11, 8, 10)
  const leaderLamps: THREE.Mesh[] = []
  for (let i = 0; i < 3; i++) {
    const chamber = new THREE.Mesh(chamberGeo, theme.mat('etcd'))
    chamber.position.set(-20 + i * 20, vy + 4, -10)
    vault.add(chamber)
    const lamp = new THREE.Mesh(theme.box(2.2, 1.2, 2.2), theme.neon(COLOR.etcd, 1.5))
    lamp.position.set(-20 + i * 20, vy + 9, -10)
    vault.add(lamp)
    leaderLamps.push(lamp)
  }

  // the ledger conveyor: one tile per committed revision, scrolling east
  const conveyorGroup = new THREE.Group()
  conveyorGroup.position.set(0, vy + 1.1, 8)
  vault.add(conveyorGroup)
  const belt = new THREE.Mesh(theme.box(CITY.vault.w - 8, 0.5, 6), theme.mat('ink'))
  conveyorGroup.add(belt)
  const ledgerGeo = theme.box(1.7, 0.5, 4.6)
  const ledger = new THREE.InstancedMesh(ledgerGeo, theme.neon(COLOR.etcd, 0.75), CONVEYOR_TILES)
  conveyorGroup.add(ledger)
  const conveyorSpan = CITY.vault.w - 12
  const conveyorPitch = conveyorSpan / CONVEYOR_TILES

  // the plaza glass: a grate floated over the pit so the ledger is always
  // visible from the street — the city walks on top of its own source of truth
  const grateMat = new THREE.MeshStandardMaterial({
    color: 0x0a1526,
    transparent: true,
    opacity: 0.34,
    roughness: 0.15,
    metalness: 0.1,
  })
  own(grateMat)
  const grate = new THREE.Mesh(theme.box(CITY.pit.x * 2 - 2, 0.5, CITY.pit.z * 2 - 2), grateMat)
  grate.position.set(0, 0.25, 0)
  vault.add(grate)
  const ribGeo = theme.box(CITY.pit.x * 2 - 2, 0.18, 0.5)
  const ribs = new THREE.InstancedMesh(ribGeo, theme.neon(COLOR.etcd, 0.35), 7)
  for (let i = 0; i < 7; i++) {
    _p.set(0, 0.55, -CITY.pit.z + 6 + i * ((CITY.pit.z * 2 - 12) / 6))
    _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
    ribs.setMatrixAt(i, _m)
  }
  ribs.instanceMatrix.needsUpdate = true
  vault.add(ribs)

  // the compaction furnace
  const fAt = ANCHOR['records.compactor']
  const furnace = new THREE.Mesh(theme.box(7, 9, 7), theme.mat('ink'))
  furnace.position.set(fAt[0], vy + 4.5, fAt[2])
  vault.add(furnace)
  const fire = new THREE.Mesh(theme.box(4.6, 2.2, 4.6), theme.neon(COLOR.podBackoff, 1.2))
  fire.position.set(fAt[0], vy + 9.6, fAt[2])
  vault.add(fire)

  /* =========================================================================
   * ZONING OFFICE + THE MAP TABLE
   * =======================================================================*/
  const zoning = new THREE.Group()
  zoning.name = 'zoning'
  group.add(zoning)

  const zAt = ANCHOR['zoning.office']
  const zbody = new THREE.Mesh(theme.box(40, 16, 30), theme.mat('sched'))
  zbody.position.set(zAt[0], 8, zAt[2])
  zoning.add(zbody)
  const zsign = new THREE.Mesh(theme.box(10, 2.2, 0.8), theme.neon(COLOR.sched, 0.9))
  zsign.position.set(zAt[0], 17.4, zAt[2] + 15.2)
  zoning.add(zsign)

  // the map table: the island itself, in miniature, under an open pavilion
  const tAt = ANCHOR['zoning.maptable']
  const tableLeg = new THREE.Mesh(theme.cyl(4.4, 5.2, 3.4, 12), theme.mat('ink'))
  tableLeg.position.set(tAt[0], 1.7, tAt[2])
  zoning.add(tableLeg)

  const islandShape = new THREE.Shape()
  writeShape(islandShape)
  const MAP_SCALE = 1 / 26
  const mapGeo = new THREE.ShapeGeometry(islandShape, 24)
  own(mapGeo)
  const mapPlate = new THREE.Mesh(mapGeo, theme.mat('ground'))
  mapPlate.rotation.x = -Math.PI / 2
  mapPlate.scale.setScalar(MAP_SCALE)
  mapPlate.position.set(tAt[0], 3.6, tAt[2])
  zoning.add(mapPlate)

  // six node minis on the table (three live, three dark)
  const miniGeo = theme.box(3.4, 1.1, 3.0)
  const minis = new THREE.InstancedMesh(miniGeo, theme.mat('kubelet'), 6)
  minis.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(18), 3)
  for (let i = 0; i < 6; i++) {
    const col = CITY.node.colX[i % 3]
    const row = CITY.node.rowZ[i < 3 ? 0 : 1]
    _p.set(tAt[0] + col * MAP_SCALE, 4.2, tAt[2] + row * MAP_SCALE)
    _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
    minis.setMatrixAt(i, _m)
  }
  minis.instanceMatrix.needsUpdate = true
  zoning.add(minis)
  const cycleLamp = new THREE.Mesh(theme.box(1.6, 1.6, 1.6), theme.neon(COLOR.sched, 1.4))
  cycleLamp.position.set(tAt[0] - 10, 5.4, tAt[2])
  zoning.add(cycleLamp)

  /* =========================================================================
   * OFFICE OF INSPECTORS
   * =======================================================================*/
  const inspectors = new THREE.Group()
  inspectors.name = 'inspectors'
  group.add(inspectors)

  const iAt = ANCHOR['inspectors.office']
  const ibody = new THREE.Mesh(theme.box(52, 14, 26), theme.mat('checkpoint'))
  ibody.position.set(iAt[0], 7, iAt[2] - 8)
  inspectors.add(ibody)

  const deskGeo = theme.box(5.6, 2.6, 4)
  const lampOn = theme.neon(COLOR.checkpoint, 1.6)
  const lampOff = theme.neon(COLOR.checkpoint, 0.12)
  const deskLamps: THREE.Mesh[] = []
  const queueMeshes: THREE.InstancedMesh[] = []
  const paperGeo = theme.box(2.6, 0.62, 2.0)

  for (let d = 0; d < DESKS.length; d++) {
    const a = ANCHOR[`inspectors.desk.${DESKS[d]}` as keyof typeof ANCHOR]
    const desk = new THREE.Mesh(deskGeo, theme.mat('ink'))
    desk.position.set(a[0], 1.3, a[2] + 8)
    inspectors.add(desk)

    const lamp = new THREE.Mesh(theme.box(1.1, 1.1, 1.1), lampOff)
    lamp.position.set(a[0], 3.4, a[2] + 8)
    inspectors.add(lamp)
    deskLamps.push(lamp)

    // the conveyor of undelivered work, stacking north behind the desk
    const queue = new THREE.InstancedMesh(paperGeo, theme.neon(COLOR.watch, 0.55), QUEUE_CAP)
    for (let i = 0; i < QUEUE_CAP; i++) {
      _p.set(a[0], 0.5, a[2] + 12.5 + i * 2.4)
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
      queue.setMatrixAt(i, _m)
    }
    queue.instanceMatrix.needsUpdate = true
    queue.count = 0
    inspectors.add(queue)
    queueMeshes.push(queue)
  }

  /* =========================================================================
   * Registration
   * =======================================================================*/

  ctx.register({
    id: 'cityhall.permitdesk',
    name: 'City Hall',
    role: 'kube-apiserver — every request passes this desk',
    kind: 'process',
    district: 'civic',
    object: hall,
    tier: 0,
    focus: { target: [H.x, 12, H.z], distance: 120, dir: [0.35, 0.42, 0.84] },
    labelAt: [H.x, H.h + 12, H.z],
    color: COLOR.civic,
    readout: (s: SimState) =>
      `${s.api.inflight.length} in admission · ${fmtNum(s.vitals.etcdRevision, 0)} revisions written`,
  })

  ctx.register({
    id: 'cityhall.watchboard',
    name: 'Watch board',
    role: 'the watch fan-out — everyone finds out the same way',
    kind: 'concept',
    district: 'civic',
    object: board,
    tier: 1,
    focus: { target: [bAt[0], bAt[1], bAt[2]], distance: 46, dir: [0.1, 0.16, 0.98] },
    color: COLOR.watch,
    readout: (s: SimState) => `worst courier lag ${s.vitals.watchMaxLagRev} rev`,
  })

  ctx.register({
    id: 'records.vault',
    name: 'Hall of Records',
    role: 'etcd — the only source of truth',
    kind: 'storage',
    district: 'records',
    object: vault,
    tier: 0,
    focus: { target: [0, vy + 4, 0], distance: 90, dir: [0.3, 0.42, 0.86] },
    labelAt: [0, 3, 0],
    color: COLOR.etcd,
    readout: (s: SimState) =>
      `rev ${fmtNum(s.etcd.revision, 0)} · compacted ${fmtNum(s.etcd.compactedRevision, 0)} · leader m${s.etcd.leader}`,
  })

  ctx.register({
    id: 'records.compactor',
    name: 'Compaction furnace',
    role: 'burns history the watchers no longer need',
    kind: 'process',
    district: 'records',
    object: furnace,
    tier: 2,
    focus: { target: [fAt[0], vy + 5, fAt[2]], distance: 40, dir: [0.5, 0.4, 0.76] },
    color: COLOR.podBackoff,
    readout: (s: SimState) => `${s.etcd.log.length} uncompacted records`,
  })

  ctx.register({
    id: 'zoning.office',
    name: 'Zoning Office',
    role: 'kube-scheduler — decides where, writes it to the ledger',
    kind: 'process',
    district: 'zoning',
    object: zbody,
    tier: 0,
    focus: { target: [zAt[0], 9, zAt[2]], distance: 86, dir: [0.5, 0.4, 0.77] },
    color: COLOR.sched,
    readout: (s: SimState) => `${s.sched.queue.length} pending · ${s.sched.scheduled} placed`,
  })

  ctx.register({
    id: 'zoning.maptable',
    name: 'The map table',
    role: 'filter, then score — placement happens on this miniature',
    kind: 'concept',
    district: 'zoning',
    object: mapPlate,
    tier: 1,
    focus: { target: [tAt[0], 4, tAt[2]], distance: 34, dir: [0.2, 0.72, 0.66] },
    color: COLOR.sched,
    readout: (s: SimState) =>
      s.sched.cycle ? `last cycle: ${s.sched.cycle.filter.length} filtered → ${s.sched.cycle.chosen ?? '—'}` : 'table idle',
  })

  ctx.register({
    id: 'inspectors.office',
    name: 'Office of Inspectors',
    role: 'controller manager — compares the ledger to the street, forever',
    kind: 'process',
    district: 'inspectors',
    object: ibody,
    tier: 0,
    focus: { target: [iAt[0], 8, iAt[2]], distance: 92, dir: [-0.42, 0.44, 0.79] },
    color: COLOR.checkpoint,
    readout: (s: SimState) => {
      let q = 0
      for (const key of DESKS) q += s.controllers[key].workqueue.length
      return `${q} keys queued across ${DESKS.length} desks`
    },
  })

  for (const key of DESKS) {
    const a = ANCHOR[`inspectors.desk.${key}` as keyof typeof ANCHOR]
    ctx.register({
      id: `inspectors.desk.${key}`,
      name: `${key} desk`,
      role:
        key === 'deployment' || key === 'replicaset'
          ? 'live reconcile desk'
          : 'desk reserved — its mechanism arrives in a later milestone',
      kind: 'process',
      district: 'inspectors',
      object: inspectors,
      tier: 2,
      focus: { target: [a[0], 3, a[2] + 6], distance: 22, dir: [0, 0.5, 0.87] },
      color: COLOR.checkpoint,
      readout: (s: SimState) => {
        const c = s.controllers[key]
        return `${c.workqueue.length} queued · ${fmtNum(c.reconciles, 0)} reconciles`
      },
    })
  }

  /* =========================================================================
   * update()
   * =======================================================================*/
  let lastCompacted = 0
  let furnacePulse = 0
  let lastRevision = 0
  let boardPulse = 0

  function update(dt: number, s: SimState, _t: number): void {
    // watch board: one row per subscriber, lit tiles = courier lag (capped)
    for (let r = 0; r < BOARD_ROWS; r++) {
      const sub = BOARD_SUBSCRIBERS[r]
      const w =
        sub === 'operator'
          ? watcherFor(s, 'operator')
          : sub.startsWith('kubelet.')
            ? watcherFor(s, sub)
            : watcherFor(s, sub === 'sched' ? 'sched' : sub)
      const lag = w ? Math.min(BOARD_COLS, s.etcd.revision - w.sentRev) : 0
      for (let col = 0; col < BOARD_COLS; col++) {
        const lit = w !== null && col < lag
        const idle = w === null
        _c.setHex(idle ? COLOR.inkDim : lit ? COLOR.watch : COLOR.grid)
        if (idle) _c.multiplyScalar(0.18)
        tiles.setColorAt(r * BOARD_COLS + col, _c)
      }
    }
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true

    // board flash on new revisions
    if (s.etcd.revision !== lastRevision) {
      boardPulse = 1
      lastRevision = s.etcd.revision
    }
    boardPulse = Math.max(0, boardPulse - dt * 2.4)
    lantern.scale.setScalar(1 + boardPulse * 0.25)

    // leader lamp
    for (let i = 0; i < 3; i++) leaderLamps[i].visible = i === s.etcd.leader

    // ledger conveyor: scroll with the revision counter
    const scroll = (s.etcd.revision * 0.35) % conveyorPitch
    for (let i = 0; i < CONVEYOR_TILES; i++) {
      _p.set(-conveyorSpan / 2 + i * conveyorPitch + scroll, 0.55, 0)
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
      ledger.setMatrixAt(i, _m)
    }
    ledger.instanceMatrix.needsUpdate = true

    // furnace pulse when compaction advances
    if (s.etcd.compactedRevision !== lastCompacted) {
      furnacePulse = 1
      lastCompacted = s.etcd.compactedRevision
    }
    furnacePulse = Math.max(0, furnacePulse - dt * 0.8)
    fire.scale.setScalar(0.7 + furnacePulse * 0.9)

    // map table lamp while a cycle is being worked
    cycleLamp.visible = s.sched.queue.length > 0 || s.sched.cycle !== undefined

    // desks: queue depth + reconcile lamp
    for (let d = 0; d < DESKS.length; d++) {
      const c = s.controllers[DESKS[d]]
      queueMeshes[d].count = Math.min(QUEUE_CAP, c.workqueue.length)
      deskLamps[d].material = c.current !== undefined ? lampOn : lampOff
    }
  }

  return {
    id: 'control-plane',
    group,
    update,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}
