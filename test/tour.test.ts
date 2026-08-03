/* Tour v1 — schema law, engine determinism, binder round-trip, invitation. */

import { afterEach, describe, expect, it } from 'vitest'

import { createBus } from '../src/core/bus'
import { MODEL_STEP_SECONDS } from '../src/core/timebase'
import type { Knobs, SimApi } from '../src/core/types'
import { actionFor } from '../src/sim/actions'
import { createSim } from '../src/sim/model'
import { samples } from '../src/sim/samples'
import { createTourEngine, type TourEngineEvent } from '../src/ui/tour-engine'
import { CHAPTERS, createTour } from '../src/ui/tour'
import { narration, resetNarrationForTests } from '../src/ui/narration'
import type { UiContext } from '../src/ui/uikit'
import { ANCHOR } from '../src/world/layout'
import { installTestDom } from './dom'

const STEP = MODEL_STEP_SECONDS

/* ------------------------------ schema law ------------------------------- */

describe('tour chapters', () => {
  it('obey the chapter law: ≤45 model-s, real focus ids, wired actions', () => {
    expect(CHAPTERS.length).toBe(10)
    const ids = new Set<string>()
    for (const ch of CHAPTERS) {
      expect(ids.has(ch.id)).toBe(false)
      ids.add(ch.id)
      expect(ch.duration).toBeGreaterThan(0)
      expect(ch.duration).toBeLessThanOrEqual(45)
      expect(ch.body.length).toBeGreaterThan(60)
      expect(ch.title.length).toBeGreaterThan(4)
      if (ch.focus) expect(ch.focus in ANCHOR, `focus ${ch.focus}`).toBe(true)
      for (const [at, id] of ch.look ?? []) {
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThanOrEqual(ch.duration)
        expect(id in ANCHOR, `look ${id}`).toBe(true)
      }
      for (const [at] of ch.commandAt ?? []) {
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThanOrEqual(ch.duration)
      }
      for (const [at, kind] of ch.act ?? []) {
        expect(at).toBeGreaterThanOrEqual(0)
        expect(at).toBeLessThanOrEqual(ch.duration)
        expect(actionFor(kind), `act ${kind}`).toBeDefined()
      }
      expect(ch.yourTurn, `${ch.id} needs a your-turn`).toBeDefined()
      expect(ch.yourTurn!.prompt.length).toBeGreaterThan(8)
    }
    // the anti-passivity law: the tour ACTS, repeatedly
    const acts = CHAPTERS.flatMap((c) => c.act ?? [])
    expect(acts.length).toBeGreaterThanOrEqual(4)
  })
})

/* --------------------------- engine determinism -------------------------- */

function runScriptedTour(): { log: string; snapshot: string } {
  const sim = createSim(createBus(), { seed: 7 })
  const events: TourEngineEvent[] = []
  const engine = createTourEngine(CHAPTERS, {
    now: () => sim.state.now,
    applyAction(kind) {
      const a = actionFor(kind)
      if (a) sim.apply(a.mkCommand(sim.state))
    },
    applyCommand(command) {
      sim.apply(command)
    },
    focus() {},
    setKnobs(knobs) {
      for (const [key, value] of Object.entries(knobs)) {
        sim.setKnob(key as keyof Knobs, value as Knobs[keyof Knobs])
      }
    },
    ensureDeployment() {
      let has = false
      for (const o of sim.state.etcd.objects.values()) {
        if (o.kind === 'Deployment' && o.name === 'shopfront') has = true
      }
      if (!has) sim.apply(samples.deployment(3))
    },
    onEvent: (e) => events.push(e),
  })

  engine.start(0)
  let guard = 0
  while (engine.running && guard < 30000) {
    guard += 1
    sim.update(STEP)
    engine.update()
    if (engine.armed && !engine.turnDone) engine.satisfy('performed')
    if (engine.canAdvance()) engine.next()
  }
  expect(engine.running).toBe(false)
  return {
    log: JSON.stringify(events.map((e) => ({ ...e, t: Math.round(e.t * 1e6) / 1e6 }))),
    snapshot: JSON.stringify(sim.toSnapshot()),
  }
}

describe('tour engine', () => {
  it('is deterministic: two fresh scripted runs are byte-identical', () => {
    const a = runScriptedTour()
    const b = runScriptedTour()
    expect(a.log).toBe(b.log)
    expect(a.snapshot).toBe(b.snapshot)
  })

  it('fires every act beat and finishes', () => {
    const { log } = runScriptedTour()
    const parsed = JSON.parse(log) as { type: string; kind?: string; reason?: string }[]
    const acted = parsed.filter((e) => e.type === 'act').map((e) => e.kind)
    expect(acted).toContain('apply-pod')
    expect(acted).toContain('delete-pod')
    expect(acted).toContain('scale-6')
    expect(acted).toContain('apply-crd')
    expect(acted).toContain('apply-lighthouse')
    const commanded = parsed.filter((e) => e.type === 'command').map((e) => e.kind)
    expect(commanded).toContain('SetOperator')
    expect(acted).toContain('set-image-v2')
    const stop = parsed.find((e) => e.type === 'stop')
    expect(stop?.reason).toBe('finished')
  })

  it('gates next on the your-turn until satisfied or skipped', () => {
    const sim = createSim(createBus(), { seed: 3 })
    const engine = createTourEngine(CHAPTERS, {
      now: () => sim.state.now,
      applyAction() {},
      focus() {},
      ensureDeployment() {},
    })
    engine.start(0)
    // run past the narration
    for (let i = 0; i < Math.ceil(23 / STEP); i++) {
      sim.update(STEP)
      engine.update()
    }
    expect(engine.armed).toBe(true)
    expect(engine.canAdvance()).toBe(false)
    expect(engine.next()).toBe(false)
    engine.satisfy('skipped')
    expect(engine.canAdvance()).toBe(true)
    expect(engine.next()).toBe(true)
    expect(engine.index).toBe(1)
  })
})

/* ----------------------- binder: card, knobs, arms ----------------------- */

interface TourDebugHandle {
  next(): boolean
  satisfy(): void
  state(): { running: boolean; index: number; armed: boolean; turnDone: boolean }
}

function uiContext(bus: ReturnType<typeof createBus>, sim: SimApi): UiContext {
  return {
    bus,
    sim,
    registry: { all: () => [], get: () => undefined, search: () => [] } as unknown as UiContext['registry'],
    getFps: () => 60,
    getQuality: () => ({
      level: 'high',
      pixelRatio: 1,
      bloom: true,
      shadows: true,
      maxParticles: 1,
      maxLabels: 1,
      antialias: true,
    }),
    getFlowStats: () => ({ active: 0, dropped: 0 }),
  }
}

describe('tour binder', () => {
  afterEach(() => resetNarrationForTests())

  it('runs start→finish through the one card and restores every knob', async () => {
    const dom = installTestDom()
    dom.mount('tour-layer')
    ;(window as unknown as { KUBETROPOLIS?: object }).KUBETROPOLIS = {}

    const bus = createBus()
    const sim = createSim(bus, { seed: 11 })
    const ctx = uiContext(bus, sim)
    const tour = createTour(ctx)
    await Promise.resolve() // let the debug handle attach

    // invitation chip is present on a fresh profile
    expect(document.querySelector('[data-tour-invitation]')).not.toBeNull()

    const knobsBefore: Knobs = { ...sim.state.knobs }
    bus.emit('tour:start', { source: 'keyboard' })
    expect(document.querySelector('[data-tour-invitation]')).toBeNull()

    const handle = (window as unknown as { KUBETROPOLIS: { tour: TourDebugHandle } }).KUBETROPOLIS.tour
    expect(handle).toBeDefined()

    const drive = (modelSeconds: number): void => {
      for (let i = 0; i < Math.ceil(modelSeconds / STEP); i++) {
        sim.update(STEP)
        tour.update(STEP, 0)
      }
    }

    // knob divergence mid-tour must be healed at the end
    sim.setKnob('timeScale', 3)

    const card = narration()
    const satisfactions: (() => void)[] = [
      () => bus.emit('select', { id: 'records.vault' }), // ch1
      () => bus.emit('trace:open', { source: 'keyboard' }), // ch2
      () => bus.emit('action:run', { kind: 'delete-pod' }), // ch3
      () => bus.emit('trace:open', { source: 'keyboard' }), // ch4
      () => handle.satisfy(), // ch5 rollback (button-equivalent)
      () => handle.satisfy(), // ch6 flake (button-equivalent)
      () => handle.satisfy(), // ch7 restore power (button-equivalent)
      () => handle.satisfy(), // ch8 calm traffic (button-equivalent)
      () => handle.satisfy(), // ch9 operator unstaff (button-equivalent)
      () => bus.emit('scenario:open', { source: 'keyboard' }), // ch10 → finishes
    ]

    let stopped = false
    bus.on('tour:stop', () => (stopped = true))

    for (let chapter = 0; chapter < CHAPTERS.length; chapter++) {
      drive(CHAPTERS[chapter].duration + 1.5)
      expect(handle.state().armed, `ch${chapter + 1} armed`).toBe(true)
      expect(card.visible).toBe(true)
      expect(card.root.textContent).toContain(`CHAPTER ${chapter + 1}/10`)
      satisfactions[chapter]()
      tour.update(STEP, 0)
      if (chapter < CHAPTERS.length - 1) {
        expect(handle.next(), `advance from ch${chapter + 1}`).toBe(true)
        tour.update(STEP, 0)
      }
    }

    expect(stopped).toBe(true)
    // exactly one card, ever
    expect(document.querySelectorAll('.tour-narrate').length).toBe(1)
    // every knob handed back exactly as found
    expect(sim.state.knobs).toEqual(knobsBefore)

    tour.dispose?.()
  })

  it('never shows the invitation once seen', () => {
    const dom = installTestDom()
    dom.mount('tour-layer')
    window.localStorage.setItem('kubetropolis.seen', '1')
    const bus = createBus()
    const sim = createSim(bus, { seed: 2 })
    const tour = createTour(uiContext(bus, sim))
    expect(document.querySelector('[data-tour-invitation]')).toBeNull()
    tour.dispose?.()
    void dom
  })
})
