/* One narration card, one voice — the singleton invariant. */

import { afterEach, describe, expect, it } from 'vitest'

import { installTestDom } from './dom'
import { narration, resetNarrationForTests } from '../src/ui/narration'

describe('narration card', () => {
  afterEach(() => resetNarrationForTests())

  it('is a singleton: asking twice returns the same card and one DOM node', () => {
    const dom = installTestDom()
    dom.mount('tour-layer')
    const a = narration()
    const b = narration()
    expect(a).toBe(b)
    expect(document.querySelectorAll('.tour-narrate').length).toBe(1)
  })

  it('renders content and stage states', () => {
    const dom = installTestDom()
    dom.mount('tour-layer')
    const card = narration()
    card.setContent({ kicker: 'apply-pod · stop 3/12', title: 'The cluster is a ledger', body: 'A row, nothing more.', code: 'revision 12' })
    card.setStages([
      { label: 'CLIENT', state: 'done' },
      { label: 'LEDGER', state: 'now' },
      { label: 'FANOUT', state: 'wait' },
    ])
    card.show(true)
    expect(card.visible).toBe(true)
    expect(card.root.classList.contains('is-trace')).toBe(true)
    expect(card.root.textContent).toContain('The cluster is a ledger')
    expect(card.root.textContent).toContain('revision 12')
    expect(card.root.querySelectorAll('.ts').length).toBe(3)
    card.hide()
    expect(card.visible).toBe(false)
  })
})
