import type { ComponentDef } from '../core/types'
import type { UiContext, UiModule } from './uikit'
import { el, setText } from './uikit'

/* ============================================================================
 * THE INSPECTOR — the one side panel. Opening anything else closes it.
 *
 * Click a building (picker emits `select`) and this shows what the component
 * IS (name, role, district), what it is DOING (the live readout, evaluated
 * every frame), and a fly-to button. Prose docs hang off this card in a later
 * milestone; the card deliberately stays small.
 * ==========================================================================*/

export function createInspector(ctx: UiContext): UiModule {
  const { bus, registry, sim } = ctx
  const host = document.getElementById('hud-right')
  if (!host) throw new Error('#hud-right missing')

  let current: ComponentDef | null = null

  const name = el('h2', { class: 'pgc-kind', text: '' })
  const role = el('p', { class: 'pg-sub', text: '' })
  const district = el('span', { class: 'pg-chip', text: '' })
  const readout = el('div', { class: 'pg-metric pg-mono', text: '' })
  const flyBtn = el('button', {
    class: 'pg-btn',
    text: 'fly to',
    on: { click: () => current && bus.emit('focus', { id: current.id }) },
  })
  const closeBtn = el('button', {
    class: 'pg-btn pg-btn--ghost',
    text: 'close',
    on: { click: () => bus.emit('select', { id: null }) },
  })

  const card = el(
    'aside',
    { class: 'pg-panel pgc-insp', style: { display: 'none' } },
    el('div', { class: 'pgc-eyebrow-row' }, district, closeBtn),
    name,
    role,
    readout,
    el('div', { class: 'pgc-fly' }, flyBtn),
  )
  host.appendChild(card)

  const offSelect = bus.on('select', ({ id }) => {
    current = id ? (registry.get(id) ?? null) : null
    card.style.display = current ? '' : 'none'
    if (current) {
      setText(name, current.name)
      setText(role, current.role)
      setText(district, current.district)
    }
  })

  const offEscape = bus.on('ui:escape', (payload) => {
    if (current && !payload.handled) {
      payload.handled = true
      bus.emit('select', { id: null })
    }
  })

  function update(): void {
    if (!current) return
    setText(readout, current.readout ? current.readout(sim.state) : '')
  }

  return {
    update,
    dispose() {
      offSelect()
      offEscape()
      card.remove()
    },
  }
}
