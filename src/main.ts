/* Kubetropolis boot — M0 first light.
 *
 * Modeled on PGSimCity's src/main.ts @ 6d2c854 (Apache-2.0, © 2026 Nikolay
 * Samokhvalov) but reduced to the M0 surface: renderer, camera rig, sky,
 * ground plate (the island), and the fixed-step timebase driving the M1-stub
 * simulation. Order matters: renderer → camera → simulation → world → loop.
 * World modules only ever read simulation state; UI talks over the bus.
 */
import * as THREE from 'three'

import './styles/tokens.css'
import './styles/ui.css'

import { createBus } from './core/bus'
import { Registry } from './core/registry'
import {
  atmosphere,
  createTheme,
  setThemeClockMinutes,
  setThemeMode,
  themeMode,
} from './core/theme'
import {
  createFrameTimebase,
  MAX_VISUAL_DELTA_SECONDS,
  simulationAnimationDelta,
  wallDelta,
} from './core/timebase'
import { clamp } from './core/util'
import type { ComponentDef, FlowRequest, WorldContext, WorldModule } from './core/types'

import { createRenderer } from './engine/renderer'
import { createCameraRig } from './engine/camera'

import { createSim, samples } from './sim/model'

import { createGround } from './world/ground'
import { createSky } from './world/sky'

import { BOOT_STEPS, failBoot, finishBoot, presentBootStep } from './ui/boot'
import { createDebugOverlay } from './ui/debug-overlay'

const bootEl = document.getElementById('boot')
const bootFill = document.getElementById('boot-fill')
const bootStatus = document.getElementById('boot-status')
const bootSurface = { root: bootEl, fill: bootFill, status: bootStatus }

function progress(step: { pct: number; label: string }): Promise<void> {
  return presentBootStep(bootSurface, step)
}

function fatal(message: string, detail?: unknown): void {
  console.error('[Kubetropolis]', message, detail)
  failBoot(bootSurface, message)
}

async function boot(): Promise<void> {
  const canvasRoot = document.getElementById('canvas-root')
  const labelsRoot = document.getElementById('labels-root')
  if (!canvasRoot || !labelsRoot) throw new Error('DOM shell is missing')

  // --- WebGL2 gate -----------------------------------------------------------
  const probe = document.createElement('canvas')
  const probeCtx = probe.getContext('webgl2')
  if (!probeCtx) {
    fatal('This browser has no WebGL2. Try a recent Chrome, Edge, Firefox or Safari.')
    return
  }
  // Hand the probe context straight back — browsers cap how many WebGL contexts
  // can be live at once, and the real one has not been created yet.
  probeCtx.getExtension('WEBGL_lose_context')?.loseContext()

  const bus = createBus()
  const registry = new Registry()
  const theme = createTheme()

  await progress(BOOT_STEPS.renderer)
  const gfx = createRenderer(canvasRoot, bus)
  const { scene, camera } = gfx

  await progress(BOOT_STEPS.camera)
  const rig = createCameraRig(camera, gfx.renderer.domElement, bus)

  await progress(BOOT_STEPS.simulation)
  const sim = createSim(bus)

  // --- the context every district is built against ---------------------------
  // sim.state is the M1-stub clock; nothing constructed at M0 reads beyond
  // knobs/t (ground's registry readouts are lazy and no UI calls them yet).
  const ctx: WorldContext = {
    scene,
    camera,
    bus,
    sim: sim.state,
    quality: gfx.quality,
    theme,
    register: (def: ComponentDef) => registry.register(def),
    flow: (req: FlowRequest) => bus.emit('flow', req),
  }

  await progress(BOOT_STEPS.ground)
  const modules: WorldModule[] = []
  const add = <T extends WorldModule>(m: T): T => {
    modules.push(m)
    scene.add(m.group)
    return m
  }
  add(createGround(ctx))

  await progress(BOOT_STEPS.sky)
  scene.add(createSky(theme))

  /* --- bus wiring ---------------------------------------------------------- */

  bus.on('focus', ({ id, instant }) => {
    if (!id) {
      rig.release()
      return
    }
    const def = registry.get(id)
    if (!def) {
      console.warn(`[Kubetropolis] focus on unknown component "${id}"`)
      return
    }
    rig.focusOn(def.focus, { instant })
  })

  // The HUD's quality select asks for a level; the renderer echoes the level it
  // ended up at. Guarded so the two can't ping-pong.
  let applyingQuality = false
  bus.on('quality', ({ level }) => {
    if (!applyingQuality && level !== gfx.quality.level) {
      applyingQuality = true
      try {
        gfx.setQuality(level)
      } finally {
        applyingQuality = false
      }
    }
  })

  bus.on('sim:reset', () => sim.reset())
  bus.on('knob', ({ key, value }) => sim.setKnob(key, value as never))

  const overlay = createDebugOverlay()

  /* --- resize -------------------------------------------------------------- */

  const onResize = () => {
    gfx.resize()
    rig.resize(canvasRoot.clientWidth, canvasRoot.clientHeight)
  }
  window.addEventListener('resize', onResize)
  onResize()

  /* --- the loop ------------------------------------------------------------ */

  const timer = new THREE.Timer()
  timer.connect(document)
  const frameTimebase = createFrameTimebase(sim.update)
  let running = true

  function frame(): void {
    if (!running) return
    requestAnimationFrame(frame)

    timer.update()
    // rawDt feeds FPS and adaptive quality. The world stays on the animation
    // clamp; the model consumes bounded wall time as fixed steps.
    const rawDt = timer.getDelta()
    const dt = clamp(rawDt, 0, MAX_VISUAL_DELTA_SECONDS)
    const elapsed = wallDelta(rawDt)
    const s = sim.state

    // 1. advance the model
    frameTimebase.advance(elapsed, s.knobs.paused, s.knobs.timeScale)
    const cityDt = simulationAnimationDelta(dt, s.knobs.paused, s.knobs.timeScale)

    // 2. camera
    rig.update(dt)

    // 3. the city
    for (let i = 0; i < modules.length; i++) modules[i].update(cityDt, s, s.now)

    // 4. draw + the M1 proof surface
    gfx.render(dt, rawDt)
    overlay.update(s)
  }

  await progress(BOOT_STEPS.firstFrame)
  rig.home(true)
  frame()

  finishBoot(bootSurface)

  /* --- teardown (hot reload / navigation) ---------------------------------- */

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    running = false
    window.removeEventListener('resize', onResize)
    overlay.dispose()
    timer.disconnect()
    for (const m of modules) m.dispose?.()
    rig.dispose()
    gfx.dispose()
    theme.dispose()
  }
  // pagehide also fires when the page goes into the back/forward cache, where it
  // is expected to come back alive. Only tear down when it is a real unload.
  window.addEventListener('pagehide', (e: PageTransitionEvent) => {
    if (e.persisted) {
      running = false // pause; pageshow restarts the loop
      return
    }
    dispose()
  })
  window.addEventListener('pageshow', () => {
    if (running || disposed) return
    running = true
    timer.update() // swallow the delta accumulated while frozen
    frame()
  })
  if (import.meta.hot) import.meta.hot.dispose(dispose)

  // Handy in the console, and the staging surface tools/shoot.mjs probes.
  const handle = {
    sim,
    samples,
    registry,
    bus,
    rig,
    gfx,
    setThemeMode,
    setThemeClockMinutes,
    themeAtmosphere: atmosphere,
    themeMode,
  }
  Object.assign(window as unknown as Record<string, unknown>, { KUBETROPOLIS: handle })
}

boot().catch((err) => fatal('Kubetropolis failed to start — see the console.', err))
