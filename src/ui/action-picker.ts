/* "Run a command" — the action picker (the sqlFor-analog surface).
 *
 * Uses the vendored .trace-picker chooser styles. Every card shows the exact
 * kubectl line and the YAML receipt; choosing one starts the narrated trace
 * in step mode. The footer states the fidelity boundary in so many words.
 */

import { listActions } from '../sim/actions'
import { narration } from './narration'
import type { UiContext, UiModule } from './uikit'
import { el, setText } from './uikit'

export function createActionPicker(ctx: UiContext): UiModule {
  const { bus } = ctx

  let open = false

  const grid = el('div', { class: 'trace-picker__grid' })
  const actions = listActions()
  const dynamicCmds: Array<{ el: HTMLElement; forState: (s: import('../core/types').SimState) => string }> = []
  for (const a of actions) {
    const cmdEl = el('code', { class: 'pg-mono', text: a.cmd, style: { display: 'block', margin: '6px 0' } })
    if (a.cmdFor) dynamicCmds.push({ el: cmdEl, forState: a.cmdFor })
    grid.appendChild(
      el(
        'button',
        {
          class: 'trace-picker__choice',
          on: {
            click: () => {
              hide()
              if (a.traceable) {
                bus.emit('trace:run', { statement: a.kind, playback: 'step' })
                return
              }
              // Untraced actions execute live with a one-line filing note —
              // unless a trace or scenario already owns the card (one voice).
              ctx.sim.apply(a.mkCommand(ctx.sim.state))
              if (!ctx.sim.state.trace && !ctx.sim.state.scenarioRun) {
                const card = narration()
                card.setContent({
                  kicker: 'FILED',
                  title: a.label,
                  body: a.watch,
                  code: a.cmdFor?.(ctx.sim.state) ?? a.cmd,
                })
                card.setStages([])
                card.setTransport([
                  el('button', { class: 'pg-btn pg-btn--ghost', text: '✕', on: { click: () => card.hide() } }),
                ])
                card.show(true)
              }
            },
          },
        },
        el('span', {}, el('strong', { text: a.label })),
        cmdEl,
        a.yaml
          ? el('pre', {
              class: 'pg-mono',
              text: a.yaml,
              style: {
                margin: '6px 0 0',
                padding: '8px',
                fontSize: '10.5px',
                lineHeight: '1.45',
                textAlign: 'left',
                overflowX: 'auto',
                background: 'var(--bg-sunken, rgba(0,0,0,.25))',
                border: '1px solid var(--line-hair, rgba(128,128,128,.3))',
              },
            })
          : el('span'),
        el('p', { class: 'pg-sub', text: a.watch, style: { margin: '8px 0 0' } }),
      ),
    )
  }

  const intro = el('p', { class: 'trace-picker__intro', text: '' })
  setText(
    intro,
    `These ${actions.length} commands are the complete grammar of this model. ` +
      'Free-form YAML would imply behavior the model does not have — every command below is ' +
      'traced through the real machinery, stop by stop.',
  )

  const closeBtn = el('button', {
    class: 'pg-btn pg-btn--ghost',
    text: '✕',
    on: { click: () => hide() },
  })

  const overlay = el(
    'div',
    { class: 'trace-picker' },
    el(
      'div',
      { class: 'pg-panel trace-picker__dialog' },
      el(
        'div',
        { class: 'trace-picker__head' },
        el('div', {}, el('p', { class: 'pg-eyebrow', text: 'RUN A COMMAND' }), el('h2', { text: 'Trace it through the city' })),
        closeBtn,
      ),
      intro,
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
    for (const d of dynamicCmds) setText(d.el, d.forState(ctx.sim.state))
    // one surface at a time: drop the inspector selection
    bus.emit('select', { id: null })
  }
  function hide(): void {
    open = false
    overlay.hidden = true
  }

  const offOpen = bus.on('trace:open', () => (open ? hide() : show()))
  const offEscape = bus.on('ui:escape', (payload) => {
    if (open && !payload.handled) {
      payload.handled = true
      hide()
    }
  })
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'r' || e.key === 'R') bus.emit('trace:open', { source: 'keyboard' })
  }
  window.addEventListener('keydown', onKey)

  return {
    update(): void {},
    dispose(): void {
      offOpen()
      offEscape()
      window.removeEventListener('keydown', onKey)
      overlay.remove()
    },
  }
}
