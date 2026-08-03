import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { NodeSim, PodObj, SimState, WorldContext, WorldModule } from '../core/types'
import { clamp01, fmtNum } from '../core/util'
import { ANCHOR, CITY, NODE_IDS, nodeCenter, nodePadPos, reserveCenter } from './layout'

/* ============================================================================
 * NODE DISTRICTS — where the desired state becomes buildings.
 *
 * Each live district is one Node: a Foreman's office (kubelet) at the gate, a
 * power substation (CPU requests) and a water tower (memory requests) with
 * honest needles, a kube-proxy signage box, and twelve building pads.
 *
 * PODS ARE BUILDINGS, and every pod in the city renders through exactly three
 * InstancedMeshes (bodies, window strips, door lights) — per-instance matrix
 * and colour, zero meshes created or destroyed as pods come and go:
 *
 *   rising from the pad   ContainerCreating (scaffold grey, growing)
 *   harbor-blue shimmer   image pull in progress on this pad
 *   lit windows           Running
 *   green door light      Ready — the door the Service will list
 *   amber door light      Running but not Ready (CLOSED sign)
 *   hazard-pulse dark     CrashLoopBackOff / ErrImagePull, waiting out backoff
 *   sinking, dimming      terminating (the demolition notice)
 *
 * The reserve row south of the live districts is dark graded pads: capacity
 * the city could commission (nodeCount knob) but has not.
 * ==========================================================================*/

const PAD_COUNT = CITY.node.pads.cols * CITY.node.pads.rows
const SLOTS = NODE_IDS.length * PAD_COUNT

/* --- module scratch: update() allocates nothing ---------------------------- */
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

/** Per-slot animation state, preallocated. */
interface SlotAnim {
  uid: string | null
  rise: number // 0..1 building height factor
  pulse: number // hazard flicker phase
}

const BODY_W = 13
const BODY_D = 11
const BODY_H = 16

export function createNodeDistricts(ctx: WorldContext): WorldModule {
  const { theme } = ctx
  const group = new THREE.Group()
  group.name = 'world.nodes'

  /* --- shared pod instancing ---------------------------------------------- */
  const bodies = new THREE.InstancedMesh(theme.box(BODY_W, BODY_H, BODY_D), theme.mat('kubelet'), SLOTS)
  bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3)
  const windows = new THREE.InstancedMesh(theme.box(BODY_W * 0.84, BODY_H * 0.62, BODY_D * 0.84), theme.neon(COLOR.podPending, 0.8), SLOTS)
  windows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3)
  const doors = new THREE.InstancedMesh(theme.box(3.2, 1.4, 1.2), theme.neon(COLOR.podReady, 1.6), SLOTS)
  doors.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3)

  /* Overflow markers: the sim is uncapped; the pads are not. When a district
   * holds more pods than pads, a hazard strip at the district edge says so —
   * visuals stay honest about what they cannot draw. */
  const overflowTiles: THREE.Mesh[] = []
  for (let n = 0; n < NODE_IDS.length; n++) {
    const [ex, , ez] = nodePadPos(n, PAD_COUNT - 1)
    const tile = new THREE.Mesh(ctx.theme.box(10, 0.5, 2.4), ctx.theme.neon(COLOR.warn, 1.1))
    tile.position.set(ex - 4, 0.6, ez + 5.4)
    tile.visible = false
    group.add(tile)
    overflowTiles.push(tile)
  }
  group.add(bodies)
  group.add(windows)
  group.add(doors)

  const slots: SlotAnim[] = []
  for (let i = 0; i < SLOTS; i++) slots.push({ uid: null, rise: 0, pulse: 0 })

  /** Reused per-frame: pods present this frame, slot-keyed. */
  const seen: (PodObj | null)[] = new Array(SLOTS).fill(null)
  /** Reused per-frame: pods needing a slot this frame. */
  const homeless: PodObj[] = []
  const overflowCounts = new Array(NODE_IDS.length).fill(0)
  /* Per-template tint: the renovation wave must READ as a wave. Colors are
   * cached per hash — allocation on first sight only, never per frame. */
  const hashTints = new Map<string, THREE.Color>()
  function tintFor(hashLabel: string | undefined): THREE.Color | null {
    if (!hashLabel) return null
    let t = hashTints.get(hashLabel)
    if (!t) {
      let h = 0
      for (let i = 0; i < hashLabel.length; i++) h = (h * 31 + hashLabel.charCodeAt(i)) | 0
      t = new THREE.Color().setHSL(((h >>> 0) % 360) / 360, 0.42, 0.46)
      hashTints.set(hashLabel, t)
    }
    return t
  }

  /* --- per-district furniture --------------------------------------------- */
  const substationNeedles: THREE.Mesh[] = []
  const towerLevels: THREE.Mesh[] = []
  const foremanLamps: THREE.Mesh[] = []
  const signageBoards: THREE.Mesh[] = []
  const padDelivery: THREE.InstancedMesh = new THREE.InstancedMesh(
    theme.box(CITY.node.pads.px - 6, 0.25, CITY.node.pads.pz - 6),
    theme.neon(COLOR.harbor, 0.9),
    SLOTS,
  )
  padDelivery.count = 0
  group.add(padDelivery)

  for (let n = 0; n < NODE_IDS.length; n++) {
    const letter = NODE_IDS[n]
    const [cx, , cz] = nodeCenter(n)
    const district = new THREE.Group()
    district.name = `node-${letter}`
    group.add(district)

    // pads
    const padGeo = theme.box(CITY.node.pads.px - 4, 0.5, CITY.node.pads.pz - 4)
    const pads = new THREE.InstancedMesh(padGeo, theme.mat('grid'), PAD_COUNT)
    for (let i = 0; i < PAD_COUNT; i++) {
      const [px, , pz] = nodePadPos(n, i)
      _p.set(px, 0.25, pz)
      _m.compose(_p, _q.identity(), _s.set(1, 1, 1))
      pads.setMatrixAt(i, _m)
    }
    pads.instanceMatrix.needsUpdate = true
    district.add(pads)

    // foreman's office (kubelet)
    const fAt = ANCHOR[`node.${letter}.foreman` as keyof typeof ANCHOR]
    const foreman = new THREE.Mesh(theme.box(16, 9, 12), theme.mat('kubelet'))
    foreman.position.set(fAt[0], 4.5, fAt[2])
    district.add(foreman)
    const fLamp = new THREE.Mesh(theme.box(1.4, 1.4, 1.4), theme.neon(COLOR.kubelet, 1.4))
    fLamp.position.set(fAt[0], 10.2, fAt[2])
    district.add(fLamp)
    foremanLamps.push(fLamp)

    // kube-proxy signage box: the posted list that lags the directory
    const gAt = ANCHOR[`node.${letter}.signage` as keyof typeof ANCHOR]
    const signage = new THREE.Mesh(theme.box(4.5, 6, 1.6), theme.mat('ink'))
    signage.position.set(gAt[0], 3, gAt[2])
    district.add(signage)
    const sBoard = new THREE.Mesh(theme.box(3.4, 4.2, 0.4), theme.neon(COLOR.client, 0.5))
    sBoard.position.set(gAt[0], 3.4, gAt[2] + 0.9)
    district.add(sBoard)
    signageBoards.push(sBoard)

    // substation (CPU): transformer drum + a needle bar that fills with load
    const sAt = ANCHOR[`node.${letter}.substation` as keyof typeof ANCHOR]
    const sub = new THREE.Mesh(theme.box(12, 6, 9), theme.mat('ink'))
    sub.position.set(sAt[0], 3, sAt[2])
    district.add(sub)
    const drum = new THREE.Mesh(theme.cyl(2.4, 2.4, 5, 12), theme.mat('kubelet'))
    drum.rotation.z = Math.PI / 2
    drum.position.set(sAt[0], 7.6, sAt[2])
    district.add(drum)
    const needle = new THREE.Mesh(theme.box(10, 1, 1), theme.neon(COLOR.warn, 1.2))
    needle.position.set(sAt[0], 6.2, sAt[2] + 5)
    needle.scale.x = 0.02
    district.add(needle)
    substationNeedles.push(needle)

    // water tower (memory): tank on legs, level ring rises with allocation
    const wAt = ANCHOR[`node.${letter}.watertower` as keyof typeof ANCHOR]
    const tank = new THREE.Mesh(theme.cyl(5.5, 5.5, 8, 14), theme.mat('kubelet'))
    tank.position.set(wAt[0], 14, wAt[2])
    district.add(tank)
    for (let leg = 0; leg < 4; leg++) {
      const lx = wAt[0] + (leg % 2 === 0 ? -3.4 : 3.4)
      const lz = wAt[2] + (leg < 2 ? -3.4 : 3.4)
      const legMesh = new THREE.Mesh(theme.cyl(0.55, 0.7, 10, 8), theme.mat('ink'))
      legMesh.position.set(lx, 5, lz)
      district.add(legMesh)
    }
    const level = new THREE.Mesh(theme.cyl(5.7, 5.7, 0.8, 14), theme.neon(COLOR.harbor, 0.9))
    level.position.set(wAt[0], 10.4, wAt[2])
    district.add(level)
    towerLevels.push(level)
  }

  // reserve row: dark graded pads, fenced, unlit
  for (let r = 0; r < 3; r++) {
    const [cx, , cz] = reserveCenter(r)
    const slab = new THREE.Mesh(theme.box(CITY.node.w - 14, 0.4, CITY.node.d - 16), theme.mat('ground'))
    slab.position.set(cx, 0.2, cz)
    group.add(slab)
    const post = new THREE.Mesh(theme.box(1.2, 4, 1.2), theme.mat('ink'))
    post.position.set(cx - CITY.node.w / 2 + 8, 2, cz - CITY.node.d / 2 + 10)
    group.add(post)
  }

  /* --- registration -------------------------------------------------------- */

  for (let n = 0; n < NODE_IDS.length; n++) {
    const letter = NODE_IDS[n]
    const name = `node-${letter}`
    const [cx, , cz] = nodeCenter(n)
    const fAt = ANCHOR[`node.${letter}.foreman` as keyof typeof ANCHOR]

    const nodeSimOf = (s: SimState): NodeSim | null => {
      for (let i = 0; i < s.nodes.length; i++) if (s.nodes[i].id === name) return s.nodes[i]
      return null
    }

    ctx.register({
      id: `node.${letter}.foreman`,
      name: `${name} foreman`,
      role: 'kubelet — reads the ledger, builds the district, reports back',
      kind: 'process',
      district: name as 'node-a',
      object: group,
      tier: 0,
      focus: { target: [fAt[0], 6, fAt[2]], distance: 60, dir: [-0.3, 0.42, 0.86] },
      labelAt: [fAt[0], 14, fAt[2]],
      color: COLOR.kubelet,
      readout: (s: SimState) => {
        const node = nodeSimOf(s)
        if (!node) return 'decommissioned'
        if (!node.powered) return 'NO POWER'
        const pull = node.pulls.length > 0 ? ` · pulling ${node.pulls[0].image}` : ''
        return `${node.kubelet.runtime.size} pods synced${pull}`
      },
    })

    // M6: the signage box becomes a citizen-facing component — the posted
    // list that LAGS the directory, which is the delete-race lesson in situ.
    const sgAt = ANCHOR[`node.${letter}.signage` as keyof typeof ANCHOR]
    ctx.register({
      id: `node.${letter}.signage`,
      name: `${name} signage (kube-proxy)`,
      role: 'network — this district’s programmed copy of the directory',
      kind: 'network',
      district: name as 'node-a',
      object: group,
      tier: 2,
      focus: { target: [sgAt[0], 4, sgAt[2]], distance: 30, dir: [-0.2, 0.4, 0.9] },
      labelAt: [sgAt[0], 8, sgAt[2]],
      color: COLOR.client,
      readout: (s: SimState) => {
        const node = nodeSimOf(s)
        if (!node) return '—'
        if (s.vitals.sliceGeneration === 0) return 'nothing posted — no Service'
        const open = node.proxy.endpoints.filter((e) => e.conditions.ready).length
        const behind = node.proxy.programmedRev < s.vitals.etcdRevision - s.vitals.watchMaxLagRev
        return `posts ${open} open (directory: ${s.vitals.readyEndpoints})${behind ? ' · catching up' : ''}`
      },
    })

    ctx.register({
      id: `node.${letter}.substation`,
      name: `${name} substation`,
      role: 'CPU — allocatable vs requested',
      kind: 'concept',
      district: name as 'node-a',
      object: group,
      tier: 2,
      focus: {
        target: [ANCHOR[`node.${letter}.substation` as keyof typeof ANCHOR][0], 5, ANCHOR[`node.${letter}.substation` as keyof typeof ANCHOR][2]],
        distance: 34,
        dir: [0.2, 0.5, 0.85],
      },
      color: COLOR.warn,
      readout: (s: SimState) => {
        const node = nodeSimOf(s)
        return node ? `${fmtNum(node.allocated.cpuM, 0)}m / ${fmtNum(node.allocatable.cpuM, 0)}m requested` : '—'
      },
    })

    ctx.register({
      id: `node.${letter}.watertower`,
      name: `${name} water tower`,
      role: 'memory — allocatable vs requested',
      kind: 'concept',
      district: name as 'node-a',
      object: group,
      tier: 2,
      focus: {
        target: [ANCHOR[`node.${letter}.watertower` as keyof typeof ANCHOR][0], 12, ANCHOR[`node.${letter}.watertower` as keyof typeof ANCHOR][2]],
        distance: 38,
        dir: [-0.2, 0.4, 0.9],
      },
      color: COLOR.harbor,
      readout: (s: SimState) => {
        const node = nodeSimOf(s)
        return node ? `${fmtNum(node.allocated.memMi, 0)}Mi / ${fmtNum(node.allocatable.memMi, 0)}Mi requested` : '—'
      },
    })
  }

  /* --- the followable traced pod (M6) ---------------------------------------
   * One marker, re-aimed at whichever building the delete rail is following.
   * The registered focus spec is MUTATED in place each frame; the camera reads
   * it at emit time, so close-ups land on the actual pad. No per-pod registry
   * bloat — exactly one followable, alive only while a trace holds a pod. */
  const tracedMarker = new THREE.Group()
  tracedMarker.name = 'pod.traced'
  group.add(tracedMarker)
  const tracedFocus = { target: [0, 6, 0] as [number, number, number], distance: 26, dir: [-0.3, 0.5, 0.85] as [number, number, number] }
  const tracedLabelAt: [number, number, number] = [0, 9, 0]
  ctx.register({
    id: 'pod.traced',
    name: 'the traced pod',
    role: 'the building the rail is following',
    kind: 'process',
    district: 'world',
    object: tracedMarker,
    tier: 2,
    focus: tracedFocus,
    labelAt: tracedLabelAt,
    color: COLOR.podTerminating,
    readout: (s: SimState) => {
      const uid = s.trace?.podUid
      if (!uid) return ''
      const pod = s.etcd.objects.get(uid)
      if (!pod || pod.kind !== 'Pod') return 'site cleared'
      const cs = pod.status.container.state
      return pod.deletionTimestamp !== undefined ? `terminating · ${cs}` : cs
    },
  })

  /* --- update -------------------------------------------------------------- */

  const nodeIndexById = new Map<string, number>()
  for (let n = 0; n < NODE_IDS.length; n++) nodeIndexById.set(`node-${NODE_IDS[n]}`, n)

  function slotBase(nodeIdx: number): number {
    return nodeIdx * PAD_COUNT
  }

  function update(dt: number, s: SimState, t: number): void {
    /* 1. Which pods exist, and where do they live?
     * Keep pods in the slot they already own; place new pods in the first
     * free pad of their node. `seen` and `homeless` are reused arrays. */
    for (let i = 0; i < SLOTS; i++) seen[i] = null
    homeless.length = 0
    overflowCounts.fill(0)

    for (const obj of s.etcd.objects.values()) {
      if (obj.kind !== 'Pod') continue
      const pod = obj as PodObj
      const nodeName = pod.spec.nodeName
      if (!nodeName) continue // Pending-unassigned pods queue at zoning, not on a pad
      const nodeIdx = nodeIndexById.get(nodeName)
      if (nodeIdx === undefined) continue
      const base = slotBase(nodeIdx)
      let placed = false
      for (let i = base; i < base + PAD_COUNT; i++) {
        if (slots[i].uid === pod.uid) {
          seen[i] = pod
          placed = true
          break
        }
      }
      if (!placed) homeless.push(pod)
    }

    for (let h = 0; h < homeless.length; h++) {
      const pod = homeless[h]
      const nodeIdx = nodeIndexById.get(pod.spec.nodeName as string)
      if (nodeIdx === undefined) continue
      const base = slotBase(nodeIdx)
      let housed = false
      for (let i = base; i < base + PAD_COUNT; i++) {
        if (slots[i].uid === null && seen[i] === null) {
          slots[i].uid = pod.uid
          slots[i].rise = 0
          slots[i].pulse = 0
          seen[i] = pod
          housed = true
          break
        }
      }
      if (!housed) overflowCounts[nodeIdx] += 1
    }

    /* 2. Drive the three instanced meshes. */
    let delivery = 0
    for (let i = 0; i < SLOTS; i++) {
      const slot = slots[i]
      const pod = seen[i]
      if (pod === null && slot.uid !== null) {
        // demolition finished this frame (object removed from the ledger)
        slot.uid = null
        slot.rise = 0
      }

      const nodeIdx = Math.floor(i / PAD_COUNT)
      const [px, , pz] = nodePadPos(nodeIdx, i % PAD_COUNT)

      if (pod === null) {
        _s.set(0.0001, 0.0001, 0.0001)
        _p.set(px, 0, pz)
        _m.compose(_p, _q.identity(), _s)
        bodies.setMatrixAt(i, _m)
        windows.setMatrixAt(i, _m)
        doors.setMatrixAt(i, _m)
        continue
      }

      const c = pod.status.container
      const terminating = pod.deletionTimestamp !== undefined || c.state === 'terminating'
      const target = terminating ? 0.12 : c.state === 'running' ? 1 : c.state === 'creating' ? 0.72 : 0.3
      const rate = terminating ? 1.6 : 0.9
      slot.rise += (target - slot.rise) * Math.min(1, dt * rate * 3)
      slot.pulse += dt

      const backoff = c.reason === 'CrashLoopBackOff' || c.reason === 'ImagePullBackOff' || c.reason === 'ErrImagePull'
      const flicker = backoff ? 0.55 + 0.45 * Math.abs(Math.sin(slot.pulse * 3.2)) : 1

      // body
      const h = Math.max(0.06, slot.rise)
      _p.set(px, (BODY_H * h) / 2 + 0.5, pz)
      _s.set(1, h, 1)
      _m.compose(_p, _q.identity(), _s)
      bodies.setMatrixAt(i, _m)
      if (terminating) _c.setHex(COLOR.podTerminating)
      else if (backoff) _c.setHex(COLOR.podBackoff)
      else {
        const tint = tintFor(pod.labels['pod-template-hash'])
        if (tint) _c.copy(tint)
        else _c.setHex(COLOR.kubelet)
      }
      if (backoff) _c.multiplyScalar(flicker)
      bodies.setColorAt(i, _c)

      // windows: lit only while running
      const wh = c.state === 'running' ? h : 0.0001
      _p.set(px, (BODY_H * h) / 2 + 0.5, pz)
      _s.set(1, wh, 1)
      _m.compose(_p, _q.identity(), _s)
      windows.setMatrixAt(i, _m)
      _c.setHex(pod.status.ready ? COLOR.podPending : COLOR.inkDim)
      windows.setColorAt(i, _c)

      // door light: the Service-facing truth
      _p.set(px, 1.4, pz + BODY_D / 2 + 0.8)
      _s.set(1, 1, 1)
      _m.compose(_p, _q.identity(), _s)
      doors.setMatrixAt(i, _m)
      _c.setHex(
        terminating ? COLOR.podTerminating : pod.status.ready ? COLOR.podReady : c.state === 'running' ? COLOR.podPending : COLOR.inkDim,
      )
      doors.setColorAt(i, _c)

      // harbor delivery glow while this pod's image is the active pull
      const node = s.nodes[nodeIdx]
      if (node && node.pulls.length > 0 && node.pulls[0].podUid === pod.uid && delivery < SLOTS) {
        _p.set(px, 0.62, pz)
        _s.set(1, 1, 1)
        _m.compose(_p, _q.identity(), _s)
        padDelivery.setMatrixAt(delivery, _m)
        delivery++
      }
    }
    padDelivery.count = delivery
    padDelivery.instanceMatrix.needsUpdate = true
    bodies.instanceMatrix.needsUpdate = true
    windows.instanceMatrix.needsUpdate = true
    doors.instanceMatrix.needsUpdate = true
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
    if (windows.instanceColor) windows.instanceColor.needsUpdate = true
    if (doors.instanceColor) doors.instanceColor.needsUpdate = true

    /* 2b. Overflow markers pulse when pads run out. */
    for (let n = 0; n < NODE_IDS.length; n++) {
      const count = overflowCounts[n]
      const tile = overflowTiles[n]
      tile.visible = count > 0
      if (count > 0) {
        const w = Math.min(1 + count * 0.35, 4)
        tile.scale.set(w, 1 + 0.25 * Math.sin(t * 4), 1)
      }
    }

    /* 2c. Aim the followable marker at the traced pod's pad (M6 delete rail). */
    const tracedUid = s.trace?.podUid
    tracedMarker.visible = false
    if (tracedUid) {
      for (let i = 0; i < SLOTS; i++) {
        if (slots[i].uid === tracedUid) {
          const [tx, , tz] = nodePadPos(Math.floor(i / PAD_COUNT), i % PAD_COUNT)
          tracedMarker.position.set(tx, 4, tz)
          tracedMarker.visible = true
          tracedFocus.target[0] = tx
          tracedFocus.target[1] = 6
          tracedFocus.target[2] = tz
          tracedLabelAt[0] = tx
          tracedLabelAt[1] = 10
          tracedLabelAt[2] = tz
          break
        }
      }
    }

    /* 3. District furniture. */
    for (let n = 0; n < NODE_IDS.length; n++) {
      const name = `node-${NODE_IDS[n]}`
      let node: NodeSim | null = null
      for (let k = 0; k < s.nodes.length; k++) if (s.nodes[k].id === name) node = s.nodes[k]
      const powered = node?.powered ?? false
      foremanLamps[n].visible = powered
      signageBoards[n].visible = powered
      const cpu = node ? clamp01(node.allocated.cpuM / Math.max(1, node.allocatable.cpuM)) : 0
      substationNeedles[n].scale.x = Math.max(0.02, cpu)
      const mem = node ? clamp01(node.allocated.memMi / Math.max(1, node.allocatable.memMi)) : 0
      towerLevels[n].position.y = 10.4 + mem * 6.4
    }
  }

  return { id: 'nodes', group, update }
}
