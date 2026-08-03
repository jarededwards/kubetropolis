/* Scenarios — directed incidents, spoken through THE narration card.
 *
 * The panel lists the incident menu (S / HUD button). While a scenario runs,
 * its beats land on the one lower-third card; a decision renders as choice
 * buttons in the card's transport slot — non-modal, the city keeps running.
 * Precedence: an active TRACE owns the card; scenario beats resume when the
 * trace ends (state holds the latest beat — nothing is lost).
 */

import { SCENARIOS, scenarioById } from '../sim/scenarios'
import { narration } from './narration'
import type { UiContext, UiModule } from './uikit'
import { el, setText } from './uikit'

export function createScenarioUi(ctx: UiContext): UiModule {
  const { bus, sim } = ctx

  let open = false

  const grid = el('div', { class: 'trace-picker__grid' })
  for (const s of SCENARIOS) {
    grid.appendChild(
      el(
        'button',
        {
          class: 'trace-picker__choice',
          on: {
            click: () => {
              hide()
              sim.startScenario(s.id)
              if (s.focus) bus.emit('focus', { id: s.focus })
            },
          },
        },
        el('span', {}, el('strong', { text: `${s.icon}  ${s.name}` })),
        el('p', { class: 'pg-sub', text: s.blurb, style: { margin: '8px 0 0' } }),
      ),
    )
  }

  const overlay = el(
    'div',
    { class: 'trace-picker', style: { zIndex: '60' } },
    el(
      'div',
      { class: 'pg-panel trace-picker__dialog' },
      el(
        'div',
        { class: 'trace-picker__head' },
        el(
          'div',
          {},
          el('p', { class: 'pg-eyebrow', text: 'SCENARIOS' }),
          el('h2', { text: 'Break the city on purpose' }),
        ),
        el('button', { class: 'pg-btn pg-btn--ghost', text: '✕', on: { click: () => hide() } }),
      ),
      el('p', {
        class: 'trace-picker__intro',
        text:
          'Each scenario changes one thing and narrates the consequence. Knobs are restored '
          + 'when it ends. Decisions are offers — the city never waits for you.',
      }),
      grid,
    ),
  )
  overlay.hidden = true
  document.body.appendChild(overlay)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hide()
  })

  function show(): void {
    open = true
    overlay.hidden = false
    bus.emit('select', { id: null })
  }
  function hide(): void {
    open = false
    overlay.hidden = true
  }

  /* --- the card ------------------------------------------------------------ */

  let lastBeatKey = ''
  let lastConsequence = ''
  let cardOwned = false

  function transportButtons(): HTMLElement[] {
    const run = sim.state.scenarioRun
    if (!run) return []
    const def = scenarioById(run.id)
    const nodes: HTMLElement[] = []
    if (run.decisionAvailable && def?.decision) {
      for (const c of def.decision.choices) {
        nodes.push(
          el('button', {
            class: 'pg-btn',
            text: c.label,
            title: c.hint,
            on: { click: () => sim.scenarioChoice(c.id) },
          }),
        )
      }
    }
    nodes.push(
      el('button', {
        class: 'pg-btn pg-btn--ghost',
        text: '✕ end scenario',
        on: { click: () => sim.endScenario() },
      }),
    )
    return nodes
  }

  function update(): void {
    const run = sim.state.scenarioRun
    const card = narration()

    // A live trace owns the card — never speak over it.
    if (sim.state.trace) return

    if (!run) {
      if (cardOwned) {
        card.hide()
        cardOwned = false
        lastBeatKey = ''
        lastConsequence = ''
      }
      return
    }

    const def = scenarioById(run.id)
    const beat = run.beat
    const key = beat ? `${run.id}:${beat.at}:${run.decisionAvailable}:${run.choiceTaken ?? ''}` : run.id
    const consequence = run.consequence ?? ''
    if (key === lastBeatKey && consequence === lastConsequence) return
    lastBeatKey = key
    lastConsequence = consequence

    card.setContent({
      kicker: `SCENARIO · ${def?.name ?? run.id}`,
      title: beat?.title ?? def?.name ?? run.id,
      body: beat?.body ?? def?.blurb ?? '',
      hint: consequence || (run.decisionAvailable ? 'Your call, operator.' : undefined),
    })
    card.setStages([])
    card.setTransport(transportButtons())
    // trace-mode styling is what makes the transport strip (decision buttons,
    // end control) visible — the vendored CSS hides the strip otherwise.
    card.show(true)
    cardOwned = true
  }

  const offOpen = bus.on('scenario:open', () => (open ? hide() : show()))
  const offEscape = bus.on('ui:escape', (payload) => {
    if (payload.handled) return
    if (open) {
      payload.handled = true
      hide()
      return
    }
    if (sim.state.scenarioRun && !sim.state.trace) {
      payload.handled = true
      sim.endScenario()
    }
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 's' || e.key === 'S') bus.emit('scenario:open', { source: 'keyboard' })
  }
  window.addEventListener('keydown', onKey)

  return {
    update,
    dispose(): void {
      offOpen()
      offEscape()
      window.removeEventListener('keydown', onKey)
      overlay.remove()
    },
  }
}
