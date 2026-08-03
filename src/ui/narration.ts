/* THE narration card — the city speaks in one voice.
 *
 * One lower-third card, module-singleton. The trace speaks through it now;
 * the tour (M5) and scenarios (M4) will speak through the SAME card. Anyone
 * who wants a second voice is wrong (CLAUDE.md: UI restraint).
 *
 * DOM uses the vendored .tour-narrate vocabulary from styles/tour.css, so
 * the card inherits upstream's tested lower-third behavior verbatim.
 */

import { el, setText } from './uikit'

export interface NarrationContent {
  kicker: string
  title: string
  body: string
  /** mono receipt line (the kubectl line, a YAML path, a counter line) */
  code?: string
  hint?: string
}

export interface StageChip {
  label: string
  state: 'wait' | 'now' | 'done'
}

export interface NarrationApi {
  setContent(c: NarrationContent): void
  setStages(stages: readonly StageChip[]): void
  /** transport buttons live in the strip, after the stages */
  setTransport(nodes: HTMLElement[]): void
  show(traceMode?: boolean): void
  hide(): void
  readonly root: HTMLElement
  readonly visible: boolean
}

let instance: NarrationApi | null = null

export function narration(): NarrationApi {
  if (instance) return instance

  const host = document.getElementById('tour-layer') ?? document.body

  const kicker = el('p', { class: 'tour-narrate__eyebrow pg-eyebrow', text: '' })
  const title = el('h2', { class: 'tour-narrate__title', text: '' })
  const body = el('p', { class: 'tour-narrate__body', text: '' })
  const code = el('div', { class: 'tour-narrate__sql', text: '' })
  const hint = el('p', { class: 'tour-narrate__hint', text: '' })
  const stagesHost = el('div', { class: 'tour-narrate__stretch' })
  const transportHost = el('span', { class: 'tour-narrate__modes' })
  const strip = el('div', { class: 'tour-narrate__strip' }, transportHost, stagesHost)

  const root = el(
    'section',
    { class: 'pg-panel tour-narrate', role: 'status' },
    kicker,
    title,
    body,
    code,
    hint,
    strip,
  )
  host.appendChild(root)

  let visible = false

  instance = {
    root,
    get visible() {
      return visible
    },
    setContent(c: NarrationContent): void {
      setText(kicker, c.kicker)
      setText(title, c.title)
      setText(body, c.body)
      setText(code, c.code ?? '')
      code.style.display = c.code ? '' : 'none'
      setText(hint, c.hint ?? '')
      hint.style.display = c.hint ? '' : 'none'
    },
    setStages(stages: readonly StageChip[]): void {
      stagesHost.textContent = ''
      for (const s of stages) {
        stagesHost.appendChild(
          el('span', {
            class: `ts is-${s.state}`,
            text: s.label,
            style: {
              marginLeft: '6px',
              opacity: s.state === 'wait' ? '0.38' : '1',
              fontWeight: s.state === 'now' ? '700' : '400',
              textDecoration: s.state === 'done' ? 'none' : 'none',
            },
          }),
        )
      }
    },
    setTransport(nodes: HTMLElement[]): void {
      transportHost.textContent = ''
      for (const n of nodes) transportHost.appendChild(n)
    },
    show(traceMode = false): void {
      visible = true
      root.classList.add('is-live', 'is-enter')
      root.classList.toggle('is-trace', traceMode)
    },
    hide(): void {
      visible = false
      root.classList.remove('is-live', 'is-enter', 'is-trace')
    },
  }
  return instance
}

/** Tests only: drop the singleton so a fresh DOM gets a fresh card. */
export function resetNarrationForTests(): void {
  instance?.root.remove()
  instance = null
}
