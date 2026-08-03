/* The guided tour — six chapters that teach the reconciliation loop.
 *
 * The runner mirrors the PGSimCity tour contract: knob snapshot on start and
 * restore on end ("the tour hands the city back exactly as it found it" —
 * dials, not history: what the reader builds stays built), enter() frames the
 * chapter, update() fires act/look beats on the MODEL clock, and everything
 * speaks through THE narration card. Chapters end with a "your turn" the
 * reader performs; `next` lights up only after they do (or explicitly skip —
 * never trap them).
 *
 * Card precedence: an active TRACE owns the card; the tour paints beneath it
 * and resumes the moment the trace ends. Scenarios yield to the tour
 * (scenario-ui checks tourIsActive()).
 */

import { CLAIM_VALUES } from '../core/claims'
import type { Knobs, TourChapter } from '../core/types'
import { actionFor } from '../sim/actions'
import { samples } from '../sim/samples'
import { narration } from './narration'
import type { UiContext, UiModule } from './uikit'
import { el } from './uikit'
import { createTourEngine, type TourEngine, type TourEngineEvent } from './tour-engine'

const HB = CLAIM_VALUES.kubeletHeartbeat
const PR = CLAIM_VALUES.probes
const RU = CLAIM_VALUES.rollingUpdate

export const CHAPTERS: readonly TourChapter[] = [
  {
    id: 'orientation',
    title: 'A city that argues with reality',
    body:
      'This city runs on one idea: you file what you want, and inspectors make it true. '
      + 'The hall ahead is City Hall — every instruction, yours or the city’s own, crosses '
      + 'its permit desk and lands in the ledger beneath. Nothing here talks to anything '
      + 'directly; state moves as couriers on roads, so you can always see who told whom.',
    focus: 'overview.balloon',
    duration: 22,
    look: [
      [8, 'cityhall.plaza'],
      [15, 'node.b.gate'],
    ],
    yourTurn: {
      prompt: 'Click any building — the inspector panel reads its live state.',
      arm: 'select',
      done: 'That panel never invents a number; it reads the same state the desks read.',
    },
  },
  {
    id: 'apply',
    title: 'The journey of a permit',
    body:
      'kubectl does very little. It hands a Pod manifest to the permit desk, where defaults '
      + 'you did not write are stamped in — probe timings, eviction tolerances, a demolition '
      + 'notice period — and the vault appends one more revision. At this moment your Pod is '
      + 'a row in a database and nothing else. Watch the board over the door: when the '
      + 'revision lands, couriers leave for every office that subscribed.',
    focus: 'cityhall.permitdesk',
    duration: 26,
    act: [[3, 'apply-pod']],
    look: [
      [8, 'records.vault'],
      [15, 'cityhall.watchboard'],
      [21, 'zoning.office'],
    ],
    yourTurn: {
      prompt: 'Open Run a command (R) and file one yourself.',
      arm: 'picker',
      done: 'Filed. Every command you will ever run enters through that same desk.',
    },
  },
  {
    id: 'reconcile',
    title: 'Nobody restarts your pod',
    body:
      'We are going to demolish a shop on camera. The ReplicaSet desk holds a contract that '
      + 'says three, counts two, and files a permit for the difference — it never visits the '
      + 'district and never touches rubble. It compares a number in the ledger to a number '
      + 'in the street, forever. That loop is most of Kubernetes; nearly everything else is '
      + 'a special case of it.',
    focus: 'inspectors.desk.replicaset',
    duration: 28,
    ensureDeployment: true,
    act: [[6, 'delete-pod']],
    look: [
      [7, 'node.a.gate'],
      [12, 'inspectors.desk.replicaset'],
      [18, 'cityhall.permitdesk'],
      [23, 'node.b.gate'],
    ],
    yourTurn: {
      prompt: 'Delete another one — the desk will not mourn this one either.',
      arm: { action: 'delete-pod' },
      done: 'Two demolitions, two replacements, zero sympathy. The contract still says three.',
    },
  },
  {
    id: 'scheduling',
    title: 'The zoning table',
    body:
      'A Pod without a district is a blueprint without an address. The Zoning Office takes '
      + 'one at a time to the map table: it strikes out districts that cannot hold the '
      + 'building, then grades the survivors — spare capacity and districts already holding '
      + 'the container score well. The winner is not a construction order; it is one more '
      + 'write to the ledger saying where. The foreman finds out the way everyone finds out '
      + 'everything: a courier.',
    focus: 'zoning.maptable',
    duration: 24,
    ensureDeployment: true,
    act: [[3, 'scale-6']],
    look: [
      [10, 'cityhall.watchboard'],
      [16, 'node.c.foreman'],
    ],
    yourTurn: {
      prompt: 'Open the console — any order you file now is yours, not the tour’s.',
      arm: 'picker',
      done: 'Yours now. The zoning table treats your paperwork exactly like the city’s.',
    },
  },
  {
    id: 'rollout',
    title: 'Renovation by replacement',
    body:
      'Nothing in this city renovates a building. shopfront v2 means new buildings: the desk '
      + 'opens a second contract for v2 and shrinks the v1 contract as replacements pass '
      + `their checks. The defaults allow ${RU.surgePct}% over budget and ${RU.unavailablePct}% `
      + 'short at a time, rounded against your replica count. No v1 door closes until a v2 '
      + 'door is open and Ready.',
    focus: 'inspectors.desk.deployment',
    duration: 34,
    ensureDeployment: true,
    act: [[4, 'set-image-v2']],
    look: [
      [9, 'harbor.crane'],
      [16, 'node.a.gate'],
      [24, 'inspectors.desk.deployment'],
    ],
    yourTurn: {
      prompt: 'Send it back.',
      arm: 'rollback',
      done: 'The old contract scales back up — it was kept at zero for exactly this moment.',
    },
  },
  {
    id: 'city',
    title: 'A healthy cluster is not quiet',
    body:
      `Run the clock. Lease renewals every ${HB.leaseRenewSeconds} model seconds, readiness `
      + `visits every ${PR.periodSeconds}, desks waking on their own timers — health here is `
      + 'periodic, not silent. Everything you watched was a row in the vault and a desk '
      + 'comparing it to the street. The scenarios menu breaks this city on purpose, and '
      + 'Help says exactly where the model ends.',
    focus: 'overview.balloon',
    duration: 20,
    look: [
      [8, 'records.vault'],
      [14, 'cityhall.watchboard'],
    ],
    yourTurn: {
      prompt: 'Go break something.',
      arm: 'scenarios',
    },
  },
]

/* --------------------------------------------------------------------------
 * Module-level flag so scenario-ui can yield the card without a dependency
 * cycle on the runner instance.
 * ------------------------------------------------------------------------*/
let active = false
export function tourIsActive(): boolean {
  return active
}

const SEEN_KEY = 'kubetropolis.seen'

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createTour(ctx: UiContext): UiModule {
  const { bus, sim } = ctx
  const cleanup: (() => void)[] = []

  let knobsBefore: Knobs | null = null
  let engine: TourEngine = createTourEngine(CHAPTERS, deps())
  let lastPaintKey = ''

  function deps() {
    return {
      now: () => sim.state.now,
      applyAction(kind: Parameters<typeof actionFor>[0]): void {
        const action = actionFor(kind)
        if (action) sim.apply(action.mkCommand(sim.state))
      },
      focus(id: string): void {
        bus.emit('focus', { id })
      },
      ensureDeployment(): void {
        let has = false
        for (const o of sim.state.etcd.objects.values()) {
          if (o.kind === 'Deployment' && o.name === 'shopfront') {
            has = true
            break
          }
        }
        if (!has) sim.apply(samples.deployment(3))
      },
      onEvent(e: TourEngineEvent): void {
        if (e.type === 'enter') {
          bus.emit('tour:chapter', { index: e.index, total: CHAPTERS.length, title: CHAPTERS[e.index].title })
        } else if (e.type === 'stop') {
          onStopped()
        }
      },
    }
  }

  function start(): void {
    if (engine.running) return
    active = true
    knobsBefore = { ...sim.state.knobs }
    hideInvitation(true)
    // one voice: the tour owns the surfaces — close what is open
    bus.emit('select', { id: null })
    engine = createTourEngine(CHAPTERS, deps())
    engine.start(0)
    lastPaintKey = ''
  }

  function onStopped(): void {
    active = false
    if (knobsBefore) {
      for (const key of Object.keys(knobsBefore) as (keyof Knobs)[]) {
        if (sim.state.knobs[key] !== knobsBefore[key]) {
          sim.setKnob(key, knobsBefore[key])
        }
      }
      knobsBefore = null
    }
    narration().hide()
    lastPaintKey = ''
    bus.emit('tour:stop', {})
  }

  /* ---------------------------- your-turn arms --------------------------- */

  function armMatches(event: 'select' | 'picker' | 'scenarios', detail?: unknown): void {
    const ch = engine.chapter
    if (!ch?.yourTurn || engine.turnDone) return
    const arm = ch.yourTurn.arm
    if (arm === event) {
      if (event === 'select' && (detail as { id: string | null } | undefined)?.id == null) return
      engine.satisfy('performed')
      if (event === 'scenarios') {
        // "Go break something" is the tour's last word — finishing is the point.
        engine.next()
      }
      lastPaintKey = ''
    }
  }

  cleanup.push(
    bus.on('tour:start', () => start()),
    bus.on('select', (p) => armMatches('select', p)),
    bus.on('trace:open', () => armMatches('picker')),
    bus.on('scenario:open', () => armMatches('scenarios')),
    bus.on('action:run', (p) => {
      const ch = engine.chapter
      if (!ch?.yourTurn || engine.turnDone) return
      const arm = ch.yourTurn.arm
      if (typeof arm === 'object' && arm.action === p.kind) {
        engine.satisfy('performed')
        lastPaintKey = ''
      } else if (arm === 'picker') {
        engine.satisfy('performed')
        lastPaintKey = ''
      }
    }),
    bus.on('ui:escape', (payload) => {
      if (payload.handled || !engine.running) return
      if (sim.state.trace) return // the trace's own Escape goes first
      payload.handled = true
      engine.stop('escaped')
    }),
  )

  // T lives in the HUD's single global keymap; it emits tour:start.

  /* --------------------------- first-run invitation ---------------------- */

  let chip: HTMLElement | null = null
  const store = storage()
  if (store && !store.getItem(SEEN_KEY)) {
    // Deliberately NOT a .pg-panel: the layout verifier's one-panel restraint
    // law audits panels, and this is a dismissable chip, not a surface.
    chip = el(
      'div',
      {
        data: { tourInvitation: 'true' },
        style: {
          position: 'fixed',
          top: '64px',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 14px',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          zIndex: '55',
          background: 'var(--bg-panel)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: '10px',
        },
      },
      el('span', { class: 'pg-sub', text: 'New here?' }),
      el('button', {
        class: 'pg-btn',
        text: 'Take the tour · T',
        on: { click: () => bus.emit('tour:start', { source: 'button' }) },
      }),
      el('button', { class: 'pg-btn pg-btn--ghost', text: '✕', on: { click: () => hideInvitation(true) } }),
    )
    document.body.appendChild(chip)
    const timer = window.setTimeout(() => hideInvitation(false), 40_000)
    cleanup.push(() => window.clearTimeout(timer))
  }

  function hideInvitation(remember: boolean): void {
    if (chip) {
      chip.remove()
      chip = null
    }
    if (remember) storage()?.setItem(SEEN_KEY, '1')
  }

  /* ------------------------------- the card ------------------------------ */

  function transport(): HTMLElement[] {
    const ch = engine.chapter
    if (!ch) return []
    const nodes: HTMLElement[] = []
    nodes.push(
      el('button', {
        class: 'pg-btn pg-btn--ghost',
        text: '‹',
        title: 'Previous chapter',
        disabled: engine.index === 0 ? true : undefined,
        on: { click: () => { engine.prev(); lastPaintKey = '' } },
      }),
    )
    const paused = sim.state.knobs.paused
    nodes.push(
      el('button', {
        class: 'pg-btn pg-btn--ghost',
        text: paused ? '▶' : '⏸',
        title: paused ? 'Resume the city' : 'Pause the city',
        on: { click: () => { sim.setKnob('paused', !sim.state.knobs.paused); lastPaintKey = '' } },
      }),
    )
    if (ch.yourTurn?.arm === 'rollback' && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn',
          text: 'kubectl rollout undo',
          on: {
            click: () => {
              sim.apply(samples.rollback())
              engine.satisfy('performed')
              lastPaintKey = ''
            },
          },
        }),
      )
    }
    const last = engine.index === CHAPTERS.length - 1
    nodes.push(
      el('button', {
        class: 'pg-btn',
        text: last ? 'End tour' : 'next ›',
        disabled: engine.canAdvance() ? undefined : true,
        on: { click: () => { engine.next(); lastPaintKey = '' } },
      }),
    )
    if (ch.yourTurn && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn pg-btn--ghost',
          text: 'skip',
          title: 'Skip the your-turn and move on',
          on: { click: () => { engine.satisfy('skipped'); lastPaintKey = '' } },
        }),
      )
    }
    nodes.push(
      el('button', {
        class: 'pg-btn pg-btn--ghost',
        text: '✕',
        title: 'End the tour',
        on: { click: () => engine.stop('closed') },
      }),
    )
    return nodes
  }

  function update(): void {
    engine.update()
    if (!engine.running) return
    // A live trace owns the card; repaint resumes when it clears.
    if (sim.state.trace) {
      lastPaintKey = ''
      return
    }
    const ch = engine.chapter
    if (!ch) return
    const key = [
      engine.index,
      engine.armed,
      engine.turnDone,
      engine.turnSkipped,
      sim.state.knobs.paused,
    ].join(':')
    if (key === lastPaintKey) return
    lastPaintKey = key

    const card = narration()
    const turn = ch.yourTurn
    let hint: string | undefined
    if (turn && engine.armed && !engine.turnDone) hint = `YOUR TURN — ${turn.prompt}`
    else if (turn && engine.turnDone && !engine.turnSkipped && turn.done) hint = turn.done
    card.setContent({
      kicker: `TOUR · CHAPTER ${engine.index + 1}/${CHAPTERS.length}`,
      title: ch.title,
      body: ch.body,
      hint,
    })
    card.setStages(
      CHAPTERS.map((c, i) => ({
        label: String(i + 1),
        state: i < engine.index ? 'done' : i === engine.index ? 'now' : 'wait',
      })),
    )
    card.setTransport(transport())
    card.show(true)
  }

  /* ------------------------- headless staging handle --------------------- */

  const debugHandle = {
    start,
    next: () => engine.next(),
    prev: () => engine.prev(),
    satisfy: () => { engine.satisfy('performed'); lastPaintKey = '' },
    skip: () => { engine.satisfy('skipped'); lastPaintKey = '' },
    stop: () => engine.stop('closed'),
    dismissInvitation: () => hideInvitation(true),
    state: () => ({
      running: engine.running,
      index: engine.index,
      armed: engine.armed,
      turnDone: engine.turnDone,
      elapsed: engine.elapsed(),
    }),
  }
  const w = window as unknown as { KUBETROPOLIS?: Record<string, unknown> }
  if (w.KUBETROPOLIS) w.KUBETROPOLIS.tour = debugHandle
  else {
    // main assembles the handle after UI construction; attach on first frame
    const attach = (): void => {
      if (w.KUBETROPOLIS && !w.KUBETROPOLIS.tour) w.KUBETROPOLIS.tour = debugHandle
    }
    cleanup.push(bus.on('tour:start', attach))
    queueMicrotask(attach)
  }

  return {
    update,
    dispose(): void {
      engine.stop('closed')
      for (const off of cleanup) off()
      hideInvitation(false)
    },
  }
}
