/* The guided tour — ten chapters that teach the reconciliation loop.
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
import type { Command, Knobs, TourChapter } from '../core/types'
import { actionFor } from '../sim/actions'
import { samples } from '../sim/samples'
import { narration } from './narration'
import type { UiContext, UiModule } from './uikit'
import { el } from './uikit'
import { createTourEngine, type TourEngine, type TourEngineEvent } from './tour-engine'

const HB = CLAIM_VALUES.kubeletHeartbeat
const PR = CLAIM_VALUES.probes
const RU = CLAIM_VALUES.rollingUpdate
const NM = CLAIM_VALUES.nodeMonitor
const TL = CLAIM_VALUES.tolerations
const HP = CLAIM_VALUES.hpa

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
      [8, 'cityhall.permitdesk'],
      [15, 'node.b.foreman'],
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
      [7, 'node.a.foreman'],
      [12, 'inspectors.desk.replicaset'],
      [18, 'cityhall.permitdesk'],
      [23, 'node.b.foreman'],
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
      + 'short at a time — surge rounds up, unavailable rounds down. At 3 replicas '
      + `floor(3 × ${RU.unavailablePct}%) = 0, so no v1 door closes until a v2 door is Ready; `
      + 'raise the replica count and maxUnavailable starts closing doors first.',
    focus: 'inspectors.desk.deployment',
    duration: 34,
    ensureDeployment: true,
    act: [[4, 'set-image-v2']],
    look: [
      [9, 'harbor.crane'],
      [16, 'node.a.foreman'],
      [24, 'inspectors.desk.deployment'],
    ],
    yourTurn: {
      prompt: 'Send it back.',
      arm: 'rollback',
      done: 'The old contract scales back up — it was kept at zero for exactly this moment.',
    },
  },
  {
    id: 'request',
    title: 'CLOSED is not condemned',
    body:
      'A caller never asks for a Pod; it dials a number. The junction board is the '
      + 'EndpointSlice — kept to whichever doors currently pass readiness — and each '
      + 'district’s signage copies it after a courier’s delay. Watch a shop start failing '
      + `its checks: after ${PR.failureThreshold} misses, ${PR.periodSeconds} model seconds `
      + 'apart, the CLOSED sign flips, the listing drops, and traffic simply stops arriving. '
      + 'No demolition. Liveness would have sent the wreckers — confusing the two probes is '
      + 'the most expensive mix-up in Kubernetes.',
    focus: 'service.junction',
    duration: 32,
    ensureDeployment: true,
    knobs: { reqPerSec: 80 },
    act: [[1, 'apply-service']],
    at: [
      [10, { chaosReadinessFlake: true }],
      [26, { chaosReadinessFlake: false }],
    ],
    look: [
      [12, 'service.directory'],
      [18, 'node.b.signage'],
      [24, 'service.junction'],
    ],
    yourTurn: {
      prompt: 'Fail the probes yourself. Watch the sign, not the wreckers.',
      arm: 'flake',
      done: 'Zero restarts. The building was never in danger — only unlisted.',
    },
  },
  {
    id: 'selfheal',
    title: 'How long nothing happens',
    body:
      'We are about to cut power to a district, and the first lesson is patience. The '
      + `foreman's lease stops renewing; after a ${NM.graceSeconds} model-second grace City Hall marks the `
      + 'district Unknown and posts the unreachable taints. The buildings then stand — every '
      + `Pod carries a ${TL.defaultSeconds} model-second toleration it never asked for. This chapter turns that `
      + 'dial down to thirty so you can watch the whole arc: countdowns, NodeLost, and the '
      + 'contract rebuilding in districts that still have lights.',
    focus: 'node.b.gate',
    duration: 44,
    ensureDeployment: true,
    knobs: { unreachableTolerationSec: 30 },
    at: [[6, { chaosNodeFail: 'node-b' }]],
    look: [
      [16, 'inspectors.office'],
      [26, 'cityhall.permitdesk'],
      [36, 'node.a.gate'],
    ],
    yourTurn: {
      prompt: 'Restore the power. Watch the countdowns cancel and the taints lift.',
      arm: 'restore',
      done: 'Heartbeats resume, the taints lift, and nothing that was rebuilt moves back — the city does not undo work.',
    },
  },
  {
    id: 'hpa',
    title: `One division, every ${HP.syncSeconds} model seconds`,
    body:
      `The autoscaler desk performs a single division on a timer: usage over target, every ${HP.syncSeconds} `
      + 'model seconds, times the current replicas, rounded up. Rush-hour traffic pushes the '
      + `ratio past the ±${HP.tolerancePct}% deadband and the desk edits exactly one number on the `
      + 'Deployment — that is everything it is permitted to do. The city turns that edit into '
      + 'buildings.',
    focus: 'inspectors.office',
    duration: 40,
    ensureDeployment: true,
    // 4× time so the stabilization window can close inside the chapter — the
    // your-turn's payoff is WATCHED, not asserted (invariance is test-proven).
    knobs: { hpaEnabled: true, hpaTargetCpuPct: 50, hpaMax: 10, reqPerSec: 220, timeScale: 4 },
    act: [[1, 'apply-service']],
    look: [
      [12, 'service.junction'],
      [22, 'inspectors.office'],
      [32, 'node.c.gate'],
    ],
    yourTurn: {
      prompt: `Drop the traffic — at 4× time, watch the ${HP.stabilizationSeconds} model-second window refuse to panic, then close.`,
      arm: 'calm',
      done:
        'Scale-up was eager; scale-down waits out the window\'s highest recommendation. '
        + 'Flapping is more expensive than patience.',
    },
  },
  {
    id: 'operator',
    title: 'A law with no inspector is paper',
    body:
      'The council can pass a law for a building Kubernetes has never heard of. The '
      + 'CustomResourceDefinition teaches City Hall a new form — watch a counter window open '
      + '— and the Lighthouse manifest is then accepted, stored, and revisioned like anything '
      + 'else. And nothing happens, because no office holds that watch. Built-in kinds come '
      + 'with inspectors; your kinds get one only if you run it.',
    focus: 'cityhall.permitdesk',
    duration: 38,
    act: [
      [3, 'apply-crd'],
      [10, 'apply-lighthouse'],
    ],
    commandAt: [[24, { kind: 'SetOperator', running: true }]],
    look: [
      [7, 'cityhall.permitdesk'],
      [14, 'harbor.lighthouse'],
      [23, 'operator.shack'],
      [30, 'harbor.lighthouse'],
    ],
    yourTurn: {
      prompt: 'Unstaff the shack — and watch the fuel gauge.',
      arm: 'operator',
      done: 'Drift always wins eventually. Reconciliation is not an event; it is an occupation.',
    },
  },
  {
    id: 'city',
    title: 'A healthy cluster is not quiet',
    body:
      `Run the clock. Lease renewals every ${HB.leaseRenewSeconds} model seconds, readiness `
      + `visits every ${PR.periodSeconds} model seconds, desks waking on their own timers — health here is `
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
      applyCommand(command: Command): void {
        sim.apply(command)
      },
      focus(id: string): void {
        bus.emit('focus', { id })
      },
      setKnobs(knobs: Partial<Knobs>): void {
        for (const [key, value] of Object.entries(knobs)) {
          sim.setKnob(key as keyof Knobs, value as Knobs[keyof Knobs])
        }
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
    // A filing (action:run), not merely opening the drawer, satisfies 'picker'.
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
    if (ch.yourTurn?.arm === 'flake' && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn',
          text: 'fail the probes',
          title: 'chaosReadinessFlake — the tour hands every knob back when it ends',
          on: {
            click: () => {
              sim.setKnob('chaosReadinessFlake', true)
              engine.satisfy('performed')
              lastPaintKey = ''
            },
          },
        }),
      )
    }
    if (ch.yourTurn?.arm === 'restore' && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn',
          text: 'restore power',
          title: 'The district comes back; armed countdowns cancel',
          on: {
            click: () => {
              sim.apply(samples.nodePower('node-b', true))
              engine.satisfy('performed')
              lastPaintKey = ''
            },
          },
        }),
      )
    }
    if (ch.yourTurn?.arm === 'calm' && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn',
          text: 'drop the traffic',
          title: 'reqPerSec → 20; the stabilization window holds the line',
          on: {
            click: () => {
              sim.setKnob('reqPerSec', 20)
              engine.satisfy('performed')
              lastPaintKey = ''
            },
          },
        }),
      )
    }
    if (ch.yourTurn?.arm === 'operator' && engine.armed && !engine.turnDone) {
      nodes.push(
        el('button', {
          class: 'pg-btn',
          text: 'unstaff the shack',
          title: 'Stop the operator — drift takes over from here',
          on: {
            click: () => {
              sim.apply(samples.setOperator(false))
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
