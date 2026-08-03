import { DESTINATIONS } from '../core/destinations'
import { ENGINE_CREDIT, NO_FOREIGN_CONTENT, TRADEMARK_NOTICE } from './legal'
import type { UiContext, UiModule } from './uikit'
import { el } from './uikit'

/* ============================================================================
 * HELP — what this is, how to drive it, and the legal line, verbatim.
 * test/trademark-notice.test.ts asserts the notice text renders here.
 * ==========================================================================*/

const KEYMAP: readonly [string, string][] = [
  ['drag / wheel', 'orbit and zoom'],
  ['click', 'inspect a component'],
  ['/', 'find anything'],
  ['`', 'simulation state overlay'],
  ['H', 'this panel'],
  ['T', 'the tour (arrives in a later milestone)'],
  ['Esc', 'close the top-most surface'],
]

export function createHelp(ctx: UiContext): UiModule {
  const { bus } = ctx
  const host = document.getElementById('help-overlay')
  if (!host) throw new Error('#help-overlay missing')

  let open = false

  const dialog = el(
    'div',
    { class: 'help-dialog' },
    el('div', { class: 'help-head' },
      el('h1', { text: 'Kubetropolis' }),
      el('button', {
        class: 'pg-btn help-close',
        text: 'close',
        on: { click: () => setOpen(false) },
      }),
    ),
    el('div', { class: 'help-body' },
      el('div', { class: 'help-what' },
        el('p', {
          text:
            'An explorable model of how Kubernetes works. City Hall is the kube-apiserver; the vault below the plaza is etcd — the only source of truth; the inspectors reconcile the ledger against the street, forever. Everything you see is driven by a deterministic simulation, and everything it simplifies is listed in FIDELITY.md.',
        }),
      ),
      el('div', { class: 'help-cols' },
        el('div', { class: 'help-col' },
          el('h2', { class: 'help-h', text: 'Controls' }),
          el('dl', { class: 'help-keymap' },
            ...KEYMAP.flatMap(([k, v]) => [
              el('dt', { class: 'pg-kbd', text: k }),
              el('dd', { text: v }),
            ]),
          ),
        ),
        el('div', { class: 'help-col' },
          el('h2', { class: 'help-h', text: 'Districts' }),
          el('ul', { class: 'help-districts' },
            ...DESTINATIONS.map((d) => el('li', { text: d.name })),
          ),
        ),
      ),
      el('div', { class: 'help-legal' },
        el('p', { text: TRADEMARK_NOTICE }),
        el('p', { text: NO_FOREIGN_CONTENT }),
        el('p', { text: ENGINE_CREDIT }),
      ),
    ),
  )

  function setOpen(next: boolean): void {
    open = next
    host!.hidden = !open
    if (open && dialog.parentElement !== host) host!.appendChild(dialog)
  }

  const offHelp = bus.on('ui:help', ({ open: want }) => setOpen(want ?? !open))
  const offEscape = bus.on('ui:escape', (payload) => {
    if (open && !payload.handled) {
      payload.handled = true
      setOpen(false)
    }
  })

  // Mount immediately so the notice is present in the DOM (hidden) from boot.
  setOpen(false)
  host.appendChild(dialog)

  return {
    update() {},
    dispose() {
      offHelp()
      offEscape()
      dialog.remove()
    },
  }
}
