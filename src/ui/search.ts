import type { ComponentDef } from '../core/types'
import type { UiContext, UiModule } from './uikit'
import { clear, el } from './uikit'

/* ============================================================================
 * SEARCH — find any registered component, Enter flies to it.
 * The registry's own fuzzy scorer does the matching; this is just a palette.
 * ==========================================================================*/

const MAX_RESULTS = 9

export function createSearch(ctx: UiContext): UiModule {
  const { bus, registry } = ctx
  const host = document.getElementById('hud')
  if (!host) throw new Error('#hud missing')

  let open = false
  let results: ComponentDef[] = []
  let cursor = 0

  const input = el('input', {
    class: 'pg-field',
    placeholder: 'find anything — vault, crane, node-b, replicaset…',
    on: {
      input: () => refine(),
      keydown: (e: Event) => onKey(e as KeyboardEvent),
    },
  }) as HTMLInputElement
  const list = el('div', { class: 'pg-scroll' })
  const box = el(
    'div',
    {
      class: 'pg-panel',
      style: {
        display: 'none',
        position: 'fixed',
        left: '50%',
        top: '16%',
        transform: 'translateX(-50%)',
        width: '440px',
        maxWidth: '92vw',
        zIndex: '40',
      },
    },
    input,
    list,
  )
  host.appendChild(box)

  function refine(): void {
    const q = input.value.trim()
    results = q ? registry.search(q).slice(0, MAX_RESULTS) : []
    cursor = 0
    render()
  }

  function render(): void {
    clear(list)
    results.forEach((def, i) => {
      list.appendChild(
        el(
          'button',
          {
            class: `pg-btn pg-btn--ghost${i === cursor ? ' pg-enter' : ''}`,
            text: `${def.name} · ${def.district}`,
            on: { click: () => go(def) },
          },
        ),
      )
    })
  }

  function go(def: ComponentDef): void {
    setOpen(false)
    bus.emit('select', { id: def.id })
    bus.emit('focus', { id: def.id })
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      cursor = Math.min(results.length - 1, cursor + 1)
      render()
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      cursor = Math.max(0, cursor - 1)
      render()
      e.preventDefault()
    } else if (e.key === 'Enter' && results[cursor]) {
      go(results[cursor])
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
      e.stopPropagation()
    }
  }

  function setOpen(next: boolean): void {
    open = next
    box.style.display = open ? '' : 'none'
    if (open) {
      input.value = ''
      refine()
      input.focus()
    } else {
      input.blur()
    }
  }

  const offPalette = bus.on('ui:palette', ({ open: want }) => setOpen(want ?? !open))
  const offEscape = bus.on('ui:escape', (payload) => {
    if (open && !payload.handled) {
      payload.handled = true
      setOpen(false)
    }
  })

  return {
    update() {},
    dispose() {
      offPalette()
      offEscape()
      box.remove()
    },
  }
}
