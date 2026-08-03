import * as THREE from 'three'
import { COLOR } from '../core/theme'
import type { SimState, WorldContext, WorldModule } from '../core/types'
import { fmtNum } from '../core/util'
import { ANCHOR, CITY } from './layout'

/* ============================================================================
 * THE HARBOR — the image registry, and the only place the city goes nautical.
 *
 * Images are cargo. They arrive by ship, stand in stacks on the quay, and a
 * crane loads them onto flatbeds for the pull roads. A district that already
 * holds a container in its cache never sends a truck — which is the entire
 * ImageLocality lesson, told with traffic.
 *
 * On the breakwater: a bare foundation. The Lighthouse is a law the council
 * has not passed yet (M7). The operator's shack at the south quay stands dark
 * until someone staffs it — an operator is just a client, far from City Hall.
 * ==========================================================================*/

const _t = new THREE.Vector3()

export function createHarbor(ctx: WorldContext): WorldModule {
  const { theme } = ctx
  const group = new THREE.Group()
  group.name = 'world.harbor'

  /* --- quay ---------------------------------------------------------------- */
  const quay = new THREE.Mesh(theme.box(30, 2.4, 132), theme.mat('ink'))
  quay.position.set(CITY.harbor.quayX + 8, -0.6, 94)
  group.add(quay)

  // M8 art pass: a flat animated water band along the quay edge - the sea
  // must READ at low quality even when the Reflector barely does.
  const bandMat = new THREE.MeshBasicMaterial({ color: 0x2a7fb8, transparent: true, opacity: 0.5 })
  bandMat.toneMapped = false
  const band = new THREE.Mesh(new THREE.PlaneGeometry(20, 300), bandMat)
  band.rotation.x = -Math.PI / 2
  band.position.set(CITY.harbor.quayX - 18, CITY.harbor.waterY + 0.25, 96)
  band.raycast = () => {}
  group.add(band)

  // bollards along the water edge
  const bollard = theme.cyl(0.5, 0.6, 1.6, 8)
  const bollards = new THREE.InstancedMesh(bollard, theme.mat('ink'), 9)
  const bm = new THREE.Matrix4()
  for (let i = 0; i < 9; i++) {
    bm.setPosition(CITY.harbor.quayX - 6, 1.2, 34 + i * 15)
    bollards.setMatrixAt(i, bm)
  }
  bollards.instanceMatrix.needsUpdate = true
  group.add(bollards)

  /* --- registry stacks ------------------------------------------------------ */
  const rAt = ANCHOR['harbor.registry']
  const containerGeo = theme.box(6.4, 2.6, 2.6)
  const STACK = 18
  const stacks = new THREE.InstancedMesh(containerGeo, theme.mat('harbor'), STACK)
  stacks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STACK * 3), 3)
  const sc = new THREE.Color()
  const sm = new THREE.Matrix4()
  for (let i = 0; i < STACK; i++) {
    const col = i % 3
    const row = Math.floor(i / 3) % 2
    const lvl = Math.floor(i / 6)
    sm.setPosition(rAt[0] + col * 7.2 - 7.2, 1.3 + lvl * 2.7, rAt[2] + row * 3.4 + 6)
    stacks.setMatrixAt(i, sm)
    sc.setHex(i % 2 === 0 ? COLOR.harbor : COLOR.backend)
    stacks.setColorAt(i, sc)
  }
  stacks.instanceMatrix.needsUpdate = true
  if (stacks.instanceColor) stacks.instanceColor.needsUpdate = true
  group.add(stacks)

  const regSign = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.2),
    new THREE.MeshBasicMaterial({
      map: theme.textTexture('harbor.city/shopfront', { size: 44, color: 'harbor' }),
      transparent: true,
    }),
  )
  regSign.position.set(rAt[0], 9.4, rAt[2] + 7)
  group.add(regSign)

  /* --- the crane ------------------------------------------------------------ */
  const cAt = ANCHOR['harbor.crane']
  const crane = new THREE.Group()
  crane.name = 'harbor.crane'
  crane.position.set(cAt[0], 0, cAt[2])
  group.add(crane)

  const tower = new THREE.Mesh(theme.box(3, 26, 3), theme.mat('harbor'))
  tower.position.y = 13
  crane.add(tower)
  const jib = new THREE.Mesh(theme.box(30, 1.6, 2), theme.mat('harbor'))
  jib.position.set(-6, 26, 0)
  crane.add(jib)
  const counter = new THREE.Mesh(theme.box(5, 3, 3), theme.mat('ink'))
  counter.position.set(9, 24.5, 0)
  crane.add(counter)
  const trolley = new THREE.Mesh(theme.box(2.4, 1.2, 2.4), theme.mat('ink'))
  trolley.position.set(-14, 25, 0)
  crane.add(trolley)
  const cable = new THREE.Mesh(theme.box(0.3, 10, 0.3), theme.mat('ink'))
  cable.position.set(-14, 19.6, 0)
  crane.add(cable)
  const hookBox = new THREE.Mesh(theme.box(6.4, 2.6, 2.6), theme.neon(COLOR.harbor, 0.9))
  hookBox.position.set(-14, 13.6, 0)
  crane.add(hookBox)

  /* --- the ship ------------------------------------------------------------- */
  const shipAt = ANCHOR['harbor.ship']
  const ship = new THREE.Group()
  ship.name = 'harbor.ship'
  ship.position.set(shipAt[0], CITY.harbor.waterY + 1.2, shipAt[2])
  group.add(ship)
  const hull = new THREE.Mesh(theme.box(16, 5, 44), theme.mat('ink'))
  hull.position.y = 2.5
  ship.add(hull)
  const bow = new THREE.Mesh(theme.box(10, 4, 8), theme.mat('ink'))
  bow.position.set(0, 2, -25)
  ship.add(bow)
  const bridge = new THREE.Mesh(theme.box(10, 8, 6), theme.mat('harbor'))
  bridge.position.set(0, 8, 16)
  ship.add(bridge)
  const deckGeo = theme.box(4.4, 2.2, 2.2)
  const deck = new THREE.InstancedMesh(deckGeo, theme.mat('harbor'), 12)
  const dm = new THREE.Matrix4()
  const dc = new THREE.Color()
  deck.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(36), 3)
  for (let i = 0; i < 12; i++) {
    dm.setPosition((i % 2) * 5 - 2.5, 6.2 + Math.floor(i / 6) * 2.4, -14 + (Math.floor(i / 2) % 3) * 9)
    deck.setMatrixAt(i, dm)
    dc.setHex(i % 3 === 0 ? COLOR.backend : COLOR.harbor)
    deck.setColorAt(i, dc)
  }
  deck.instanceMatrix.needsUpdate = true
  if (deck.instanceColor) deck.instanceColor.needsUpdate = true
  ship.add(deck)

  /* --- breakwater + the empty lighthouse foundation ------------------------- */
  const lAt = ANCHOR['harbor.lighthouse']
  const spine: [number, number][] = [
    [-452, -2],
    [-464, -7],
    [-476, -11],
    [-486, -14],
  ]
  for (let i = 0; i < spine.length; i++) {
    const wall = new THREE.Mesh(theme.box(10, 2.6, 7), theme.mat('ink'))
    wall.position.set(spine[i][0], 1.3, spine[i][1])
    wall.rotation.y = -0.35
    group.add(wall)
  }
  const foundation = new THREE.Mesh(theme.cyl(4.4, 5, 1.6, 12), theme.mat('ground'))
  foundation.position.set(lAt[0], 0.8, lAt[2])
  group.add(foundation)

  /* --- the Lighthouse itself (M7) -------------------------------------------
   * Rises when the OPERATOR files construction — an admitted row alone builds
   * nothing (a law with no inspector is paper). Scale-Y animates the build. */
  const TOWER_H = 22
  const lighthouse = new THREE.Group()
  lighthouse.name = 'harbor.lighthouse.tower'
  lighthouse.position.set(lAt[0], 1.6, lAt[2])
  lighthouse.visible = false
  group.add(lighthouse)

  const towerBody = new THREE.Mesh(theme.cyl(2.2, 3.4, TOWER_H, 12), theme.mat('harbor'))
  towerBody.position.y = TOWER_H / 2
  lighthouse.add(towerBody)
  const gallery = new THREE.Mesh(theme.cyl(3.0, 3.0, 1.2, 12), theme.mat('ink'))
  gallery.position.y = TOWER_H + 0.6
  lighthouse.add(gallery)
  const lampRoom = new THREE.Mesh(theme.box(3.4, 3, 3.4), theme.mat('ink'))
  lampRoom.position.y = TOWER_H + 2.7
  lighthouse.add(lampRoom)
  const lamp = new THREE.Mesh(theme.box(1.6, 1.6, 1.6), theme.neon(COLOR.crd, 2.0))
  lamp.position.y = TOWER_H + 2.7
  lamp.visible = false
  lighthouse.add(lamp)

  // the sweeping beam: two opposed blades riding a pivot at lamp height
  const beamPivot = new THREE.Group()
  beamPivot.position.y = TOWER_H + 2.7
  beamPivot.visible = false
  lighthouse.add(beamPivot)
  // Soft falloff along the blade so the beam reads as rotating LIGHT, not a
  // rod skewering the tower (the day theme especially). A tiny gradient
  // alphaMap does it: bright at the lamp, gone at the tip.
  const beamFade = (() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 4
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createLinearGradient(0, 0, 64, 0)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(0.55, '#9a9a9a')
      grad.addColorStop(1, '#000000')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 4)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.name = 'Kubetropolis.beam.falloff'
    return tex
  })()
  const beamGeo = new THREE.BoxGeometry(46, 0.5, 1.6)
  for (const dir of [1, -1]) {
    const mat = theme.neon(COLOR.crd, 1.35) as THREE.MeshBasicMaterial
    mat.transparent = true
    mat.opacity = 0.8
    mat.alphaMap = beamFade
    mat.depthWrite = false
    const blade = new THREE.Mesh(beamGeo, mat)
    blade.position.x = dir * 24
    if (dir === -1) blade.rotation.y = Math.PI
    blade.raycast = () => {}
    beamPivot.add(blade)
  }

  // fuel gauge: a thin column beside the tower, height = street-truth fuel
  const gaugeBack = new THREE.Mesh(theme.box(1.1, 12, 1.1), theme.mat('ink'))
  gaugeBack.position.set(5.4, 6, 0)
  lighthouse.add(gaugeBack)
  const gaugeFill = new THREE.Mesh(theme.box(0.7, 12, 0.7), theme.neon(COLOR.harbor, 1.0))
  gaugeFill.position.set(5.4, 6, 0)
  lighthouse.add(gaugeFill)

  /* --- the operator's shack ------------------------------------------------- */
  const oAt = ANCHOR['operator.shack']
  const shack = new THREE.Mesh(theme.box(9, 6, 7), theme.mat('ink'))
  shack.position.set(oAt[0], 3, oAt[2])
  group.add(shack)
  const shackLamp = new THREE.Mesh(theme.box(1.2, 1.2, 1.2), theme.neon(COLOR.crd, 1.5))
  shackLamp.position.set(oAt[0], 7, oAt[2])
  shackLamp.visible = false
  group.add(shackLamp)

  /* --- registration --------------------------------------------------------- */

  const anyPull = (s: SimState): { image: string; pct: number } | null => {
    for (let i = 0; i < s.nodes.length; i++) {
      const pulls = s.nodes[i].pulls
      if (pulls.length > 0) {
        return { image: pulls[0].image, pct: pulls[0].doneMB / Math.max(1, pulls[0].totalMB) }
      }
    }
    return null
  }

  ctx.register({
    id: 'harbor.crane',
    name: 'Registry crane',
    role: 'image pulls load here — cached districts never send a truck',
    kind: 'process',
    district: 'harbor',
    object: crane,
    tier: 0,
    focus: { target: [cAt[0], 14, cAt[2]], distance: 80, dir: [0.72, 0.36, 0.6] },
    labelAt: [cAt[0], 30, cAt[2]],
    color: COLOR.harbor,
    readout: (s: SimState) => {
      if (!s.harbor.reachable) return 'FOG — registry unreachable'
      const p = anyPull(s)
      return p ? `pulling ${p.image} · ${fmtNum(p.pct * 100, 0)}%` : `idle · ${fmtNum(s.harbor.mbps, 0)} MB/s`
    },
  })

  ctx.register({
    id: 'harbor.registry',
    name: 'Registry stacks',
    role: 'harbor.city — every image the city can build from',
    kind: 'storage',
    district: 'harbor',
    object: stacks,
    tier: 1,
    focus: { target: [rAt[0], 4, rAt[2] + 6], distance: 52, dir: [0.6, 0.42, 0.68] },
    color: COLOR.harbor,
    readout: (s: SimState) => `${fmtNum(s.vitals.imagePullsActive, 0)} pulls active`,
  })

  ctx.register({
    id: 'harbor.ship',
    name: 'Container ship',
    role: 'how images reached the registry in the first place',
    kind: 'concept',
    district: 'harbor',
    object: ship,
    tier: 2,
    focus: { target: [shipAt[0], 6, shipAt[2]], distance: 70, dir: [0.8, 0.3, 0.52] },
    color: COLOR.harbor,
  })

  ctx.register({
    id: 'harbor.lighthouse',
    name: 'Lighthouse',
    role: 'a custom resource — real only while its operator keeps it real',
    kind: 'concept',
    district: 'harbor',
    object: lighthouse,
    tier: 1,
    focus: { target: [lAt[0], 12, lAt[2]], distance: 56, dir: [0.7, 0.34, 0.62] },
    labelAt: [lAt[0], TOWER_H + 9, lAt[2]],
    color: COLOR.crd,
    readout: (s: SimState) => {
      const b = s.beacon
      if (!b) {
        return s.vitals.crdRegistered
          ? 'foundation only — apply the Lighthouse, then staff the shack'
          : 'foundation only — no law permits this building yet'
      }
      if (!b.built) return 'under construction — the operator filed the build'
      if (!b.lit) return `dark · fuel ${b.fuelPct.toFixed(0)}%`
      return `lit · fuel ${b.fuelPct.toFixed(0)}% · beam ${b.beamRpm} rpm`
    },
  })

  ctx.register({
    id: 'operator.shack',
    name: "Operator's shack",
    role: 'an operator is just a client, far from the control plane',
    kind: 'process',
    district: 'harbor',
    object: shack,
    tier: 1,
    focus: { target: [oAt[0], 4, oAt[2]], distance: 40, dir: [0.6, 0.4, 0.7] },
    color: COLOR.crd,
    readout: (s: SimState) =>
      s.operatorRunning
        ? `staffed · reconciles ${s.controllers.lighthouse.reconciles} · courier ×1.6 (longest road)`
        : 'dark. nobody holds this watch',
  })

  /* --- fog bank (chaosRegistryOutage) --------------------------------------- */
  const fog = new THREE.Group()
  for (let i = 0; i < 3; i++) {
    const slab = new THREE.Mesh(
      theme.box(46 - i * 8, 7 + i * 3, 30 - i * 5),
      new THREE.MeshBasicMaterial({ color: 0x9aa7b4, transparent: true, opacity: 0.16 + i * 0.05, depthWrite: false }),
    )
    slab.position.set(cAt[0] - 8 + i * 10, 6 + i * 3, cAt[2] + 4 - i * 6)
    fog.add(slab)
  }
  fog.visible = false
  group.add(fog)

  /* --- update ---------------------------------------------------------------- */

  let craneSwing = 0

  function update(dt: number, s: SimState, t: number): void {
    const p = anyPull(s)
    const active = p !== null && s.harbor.reachable
    if (active) {
      craneSwing += dt
      const k = (Math.sin(craneSwing * 1.4) + 1) / 2
      trolley.position.x = -20 + k * 14
      cable.position.x = trolley.position.x
      hookBox.position.x = trolley.position.x
      const drop = p ? 6 + (1 - p.pct) * 6 : 8
      cable.scale.y = drop / 10
      cable.position.y = 25.6 - drop / 2
      hookBox.position.y = 25.6 - drop
      hookBox.visible = true
    } else {
      hookBox.visible = false
      trolley.position.x = -14
      cable.position.set(-14, 19.6, 0)
      cable.scale.y = 1
    }

    // gentle ride at anchor
    ship.position.y = CITY.harbor.waterY + 1.2 + Math.sin(t * 0.5) * 0.35
    ship.rotation.z = Math.sin(t * 0.4) * 0.012

    shackLamp.visible = s.operatorRunning

    // the Lighthouse: rises with construction, sweeps while lit, reads fuel
    const b = s.beacon
    lighthouse.visible = b !== null
    if (b) {
      const progress = b.built
        ? 1
        : Math.max(0.08, 1 - Math.max(0, b.buildingUntil - s.now) / 6)
      lighthouse.scale.y = progress
      lamp.visible = b.lit
      beamPivot.visible = b.lit
      if (b.lit) {
        // rpm → radians per model second; ride the same clock as the city
        beamPivot.rotation.y = (t * b.beamRpm * Math.PI * 2) / 60
      }
      const fuel = Math.max(0.02, b.fuelPct / 100)
      gaugeFill.scale.y = fuel
      gaugeFill.position.y = 6 - (12 * (1 - fuel)) / 2
    }

    // the fog bank rolls in when the registry is unreachable
    fog.visible = !s.harbor.reachable
    if (fog.visible) fog.position.x = Math.sin(t * 0.18) * 3
  }

  return { id: 'harbor', group, update }
}
