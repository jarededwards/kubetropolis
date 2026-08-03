import type { UiContext, UiModule } from './uikit'
import { el, setText } from './uikit'
import { fmtNum } from '../core/util'

/* ============================================================================
 * THE HUD — deliberately thin. The 3D city is the product; chrome yields.
 *
 * Top bar only: brand, live vitals (revision · pods · nodes), day/night, fps.
 * One keymap, owned here:  /  search · H help · ` sim overlay (debug-overlay)
 * Escape is offered to every overlay first (`ui:escape` with { handled }),
 * exactly the upstream precedence pattern — the HUD never slams a door an
 * overlay was using.
 * ==========================================================================*/

export function createHud(ctx: UiContext): UiModule {
  const { bus, sim } = ctx
  const top = document.getElementById('hud-top')
  if (!top) throw new Error('#hud-top missing')

  const rev = el('span', { class: 'hud-chip pg-mono', text: 'rev 0' })
  const pods = el('span', { class: 'hud-chip pg-mono', text: '0/0 pods' })
  const nodes = el('span', { class: 'hud-chip pg-mono', text: '0 nodes' })
  const fps = el('span', { class: 'hud-perf pg-mono', text: '' })

  const runBtn = el('button', {
    class: 'pg-btn',
    text: 'run a command ▸',
    title: 'Trace a kubectl command through the city (R)',
    on: { click: () => bus.emit('trace:open', { source: 'button' }) },
  })
  const themeBtn = el('button', {
    class: 'pg-btn pg-btn--ghost',
    text: 'day/night',
    title: 'Toggle day and night (T is reserved for the tour)',
    on: { click: () => bus.emit('ui:theme-toggle', {}) },
  })
  const helpBtn = el('button', {
    class: 'pg-btn pg-btn--ghost',
    text: 'help',
    title: 'Help & about (H)',
    on: { click: () => bus.emit('ui:help', { open: true }) },
  })
  const searchBtn = el('button', {
    class: 'pg-btn pg-btn--ghost',
    text: 'search /',
    title: 'Find any component (/)',
    on: { click: () => bus.emit('ui:palette', { open: true }) },
  })

  const bar = el(
    'div',
    {
      class: 'hud-bar',
      style: { display: 'flex', gap: '14px', alignItems: 'center', padding: '8px 14px' },
    },
    el('span', { class: 'hud-brand', text: 'Kubetropolis' }),
    el('span', { class: 'hud-sep' }),
    rev,
    pods,
    nodes,
    el(
      'span',
      { class: 'hud-right', style: { display: 'flex', gap: '10px', alignItems: 'center', marginLeft: 'auto' } },
      fps,
      runBtn,
      searchBtn,
      themeBtn,
      helpBtn,
    ),
  )
  top.appendChild(bar)

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === '/') {
      e.preventDefault()
      bus.emit('ui:palette', { open: true })
    } else if (e.key === 'h' || e.key === 'H' || e.key === '?') {
      bus.emit('ui:help', { open: true })
    } else if (e.key === 'Escape') {
      // Offer Escape to overlays first; if someone handles it, stop there.
      const payload = { handled: false }
      bus.emit('ui:escape', payload)
      if (!payload.handled) bus.emit('select', { id: null })
    }
  }
  window.addEventListener('keydown', onKey)

  let acc = 0
  function update(dt: number): void {
    acc += dt
    if (acc < 0.25) return
    acc = 0
    const s = sim.state
    setText(rev, `rev ${fmtNum(s.vitals.etcdRevision, 0)}`)
    setText(pods, `${s.vitals.podsReady}/${s.vitals.podsTotal} pods ready`)
    setText(nodes, `${s.vitals.nodesReady} nodes`)
    setText(fps, `${Math.round(ctx.getFps())} fps · ${ctx.getQuality().level}`)
  }

  return {
    update,
    dispose() {
      window.removeEventListener('keydown', onKey)
      bar.remove()
    },
  }
}
