/* The trace controller: glues sim.state.trace to the one narration card.
 *
 * - 'trace:run' arms the sim trace and takes the stage (body.pg-tour dims
 *   the chrome so the city reads).
 * - Each frame, if the stop or its counters changed, the card re-renders and
 *   the camera flies to the stop's component.
 * - Transport: ‹ back through visited stops · step/slow/live · next ›.
 *   "next" resumes a step-mode auto-pause; while reviewing an earlier stop
 *   it first pages forward through what was already seen.
 * - Esc closes the trace before anything else (ui:escape precedence).
 */

import { presentedStages } from '../core/trace-presentation'
import type { TracePlayback, TraceRecord, TraceStop } from '../core/types'
import { traceStopBit } from '../core/model-helpers'
import { narration } from './narration'
import { traceCopyFor, traceFocusId } from './trace-copy'
import type { UiContext, UiModule } from './uikit'
import { el } from './uikit'

export function createTraceUi(ctx: UiContext): UiModule {
  const { bus, sim } = ctx

  let active = false
  let viewStop: TraceStop | null = null
  let lastFocus = ''
  let lastLine = ''
  let acc = 0
  let fixShown = false

  const card = narration()

  /* ---- transport ---------------------------------------------------------*/

  const prevBtn = el('button', {
    class: 'pg-btn pg-btn--ghost tour-btn',
    text: '‹',
    title: 'Back through visited stops',
    on: { click: () => page(-1) },
  })
  const nextBtn = el('button', {
    class: 'pg-btn tour-btn tour-btn--next',
    text: 'next ›',
    title: 'Advance (step mode pauses at every stop)',
    on: { click: () => page(1) },
  })
  const modeBtns = (['step', 'slow', 'live'] as TracePlayback[]).map((mode) =>
    el('button', {
      class: 'pg-btn pg-btn--ghost tour-narrate__mode',
      text: mode,
      on: {
        click: () => {
          sim.setTracePlayback(mode)
          refreshModes()
        },
      },
    }),
  )
  const closeBtn = el('button', {
    class: 'pg-btn pg-btn--ghost tour-narrate__close',
    text: '✕',
    title: 'Close the trace (Esc)',
    on: { click: () => stop() },
  })
  // The lesson closes itself: re-run the delete with a preStop sleep longer
  // than the observed propagation and watch the misroute counter stay at zero.
  const fixBtn = el('button', {
    class: 'pg-btn tour-btn tour-btn--fix',
    text: 'try the fix',
    title: 'Re-run with a preStop sleep longer than the propagation',
    on: {
      click: () => {
        const t = sim.state.trace
        if (!t) return
        const fixSec = t.suggestedPreStopSec
        const playback = t.playback
        stop()
        sim.setKnob('preStopSleepSec', fixSec, 'user')
        bus.emit('toast', { text: `preStopSleepSec → ${fixSec} — re-running the delete`, kind: 'info' })
        start('delete-pod', playback)
      },
    },
  })

  function refreshModes(): void {
    const t = sim.state.trace
    for (let i = 0; i < modeBtns.length; i++) {
      modeBtns[i].classList.toggle('is-active', t?.playback === modeBtns[i].textContent)
    }
  }

  /** Visited stops, in rail order, up to the sim's current stop. */
  function visitedRail(t: TraceRecord): TraceStop[] {
    const out: TraceStop[] = []
    for (const s of presentedStages(t.action)) {
      if ((t.visited & traceStopBit(s.stop)) !== 0) out.push(s.stop)
      if (s.stop === t.stop) break
    }
    return out
  }

  function page(dir: 1 | -1): void {
    const t = sim.state.trace
    if (!t) return
    const rail = visitedRail(t)
    const cur = viewStop ?? t.stop
    const i = rail.indexOf(cur)
    if (dir === -1) {
      if (i > 0) viewStop = rail[i - 1]
    } else if (i < rail.length - 1) {
      viewStop = rail[i + 1]
    } else {
      // at the frontier: advance the sim itself
      viewStop = null
      sim.traceNext()
    }
    render(true)
  }

  /* ---- lifecycle ---------------------------------------------------------*/

  function start(statement: Parameters<typeof sim.startTrace>[0], playback: TracePlayback): void {
    sim.startTrace(statement, playback)
    if (!sim.state.trace) return
    active = true
    viewStop = null
    lastFocus = ''
    fixShown = false
    document.body.classList.add('pg-tour')
    card.setTransport([prevBtn, ...modeBtns, nextBtn, closeBtn])
    card.show(true)
    refreshModes()
    render(true)
  }

  function stop(): void {
    if (!active) return
    active = false
    viewStop = null
    sim.endTrace()
    document.body.classList.remove('pg-tour')
    card.hide()
    bus.emit('focus', { id: null })
  }

  /* ---- render ------------------------------------------------------------*/

  function render(force = false): void {
    const t = sim.state.trace
    if (!t) {
      if (active) stop()
      return
    }
    const shown = viewStop ?? t.stop
    const copy = traceCopyFor(t, shown)
    const line = copy.line(t)
    if (!force && shown === viewStop && line === lastLine) return
    if (!force && viewStop === null && line === lastLine && lastFocus === traceFocusId(shown, t)) return

    const rail = presentedStages(t.action)
    const idx = rail.findIndex((s) => s.stop === shown)
    const replay = viewStop !== null && viewStop !== t.stop
    card.setContent({
      kicker: `${t.action} · stop ${idx + 1}/${rail.length}${replay ? ' · replay' : ''}${
        t.autoPaused && !replay ? ' · paused' : ''
      }`,
      title: copy.title,
      body: copy.body(t),
      code: line,
      hint: copy.hint,
    })
    card.setStages(
      rail.map((s) => ({
        label: s.label,
        state: s.stop === shown ? 'now' : (t.visited & traceStopBit(s.stop)) !== 0 ? 'done' : 'wait',
      })),
    )
    lastLine = line

    // The delete rail's closing affordance: only when the race had victims.
    const offerFix =
      t.action === 'delete-pod' && t.stop === 'done' && t.trafficLive && t.misroutedSince > 0
      && t.savedKnobs.preStopSleepSec < t.suggestedPreStopSec
    if (offerFix && !fixShown) {
      fixShown = true
      fixBtn.textContent = `try the fix: preStop ${t.suggestedPreStopSec}s`
      card.setTransport([prevBtn, ...modeBtns, fixBtn, nextBtn, closeBtn])
    } else if (!offerFix && fixShown) {
      fixShown = false
      card.setTransport([prevBtn, ...modeBtns, nextBtn, closeBtn])
    }

    const focus = traceFocusId(shown, t)
    if (focus !== lastFocus) {
      lastFocus = focus
      bus.emit('focus', { id: focus })
    }
  }

  /* ---- bus ---------------------------------------------------------------*/

  const offRun = bus.on('trace:run', ({ statement, playback }) => start(statement, playback))
  const offEscape = bus.on('ui:escape', (payload) => {
    if (active && !payload.handled) {
      payload.handled = true
      stop()
    }
  })

  return {
    update(dt: number): void {
      if (!active) return
      acc += dt
      if (acc < 0.12) return
      acc = 0
      render()
      refreshModes()
    },
    dispose(): void {
      offRun()
      offEscape()
      stop()
    },
  }
}
