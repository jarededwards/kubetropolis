/* The tour engine — pure chapter clockwork, no DOM, no three.js.
 *
 * Timing is MODEL seconds via deps.now() (the sim clock), so pausing the
 * city pauses the tour, and identical now() sequences yield identical event
 * logs — the determinism test drives this engine against a real headless sim
 * twice and diffs the logs byte-for-byte.
 *
 * The binder (src/ui/tour.ts) owns DOM, the narration card, and arm wiring;
 * this module owns WHAT happens WHEN.
 */

import type { ActionKind, Knobs, TourChapter } from '../core/types'

export type TourEngineEvent =
  | { t: number; type: 'start'; index: number }
  | { t: number; type: 'enter'; index: number; id: string }
  | { t: number; type: 'act'; kind: ActionKind }
  | { t: number; type: 'look'; id: string }
  | { t: number; type: 'knobs'; keys: string[] }
  | { t: number; type: 'armed'; index: number }
  | { t: number; type: 'your-turn-done'; index: number; how: 'performed' | 'skipped' }
  | { t: number; type: 'stop'; reason: 'finished' | 'escaped' | 'closed' }

export interface TourEngineDeps {
  /** model seconds — sim.state.now */
  now(): number
  applyAction(kind: ActionKind): void
  focus(id: string): void
  /** apply chapter knobs / at-beats (restored by the binder on tour end) */
  setKnobs(knobs: Partial<Knobs>): void
  /** stand up the demo Deployment when a chapter asks for one */
  ensureDeployment(): void
  onEvent?(e: TourEngineEvent): void
}

export interface TourEngine {
  readonly running: boolean
  readonly index: number
  readonly chapter: TourChapter | null
  /** model seconds into the current chapter */
  elapsed(): number
  /** narration timer finished; the your-turn prompt (if any) is live */
  readonly armed: boolean
  /** the reader performed (or skipped) the your-turn */
  readonly turnDone: boolean
  readonly turnSkipped: boolean
  canAdvance(): boolean
  start(at?: number): void
  /** advance beats; call once per frame (and per test step) */
  update(): void
  /** returns false when gated by an unperformed your-turn */
  next(): boolean
  prev(): void
  goTo(i: number): void
  satisfy(how?: 'performed' | 'skipped'): void
  stop(reason?: 'finished' | 'escaped' | 'closed'): void
}

export function createTourEngine(chapters: readonly TourChapter[], deps: TourEngineDeps): TourEngine {
  let running = false
  let index = 0
  let enteredAt = 0
  let actIdx = 0
  let lookIdx = 0
  let atIdx = 0
  let armed = false
  let turnDone = false
  let turnSkipped = false

  const emit = (e: TourEngineEvent): void => deps.onEvent?.(e)
  const now = (): number => deps.now()

  function enter(i: number): void {
    index = i
    enteredAt = now()
    actIdx = 0
    lookIdx = 0
    atIdx = 0
    armed = false
    turnDone = false
    turnSkipped = false
    const ch = chapters[i]
    if (ch.ensureDeployment) deps.ensureDeployment()
    if (ch.knobs) {
      deps.setKnobs(ch.knobs)
      emit({ t: now(), type: 'knobs', keys: Object.keys(ch.knobs).sort() })
    }
    if (ch.focus) deps.focus(ch.focus)
    emit({ t: now(), type: 'enter', index: i, id: ch.id })
  }

  return {
    get running() {
      return running
    },
    get index() {
      return index
    },
    get chapter() {
      return running ? chapters[index] : null
    },
    elapsed() {
      return running ? now() - enteredAt : 0
    },
    get armed() {
      return armed
    },
    get turnDone() {
      return turnDone
    },
    get turnSkipped() {
      return turnSkipped
    },
    canAdvance() {
      if (!running || !armed) return false
      return chapters[index].yourTurn ? turnDone : true
    },
    start(at = 0): void {
      if (running) return
      running = true
      emit({ t: now(), type: 'start', index: at })
      enter(at)
    },
    update(): void {
      if (!running) return
      const ch = chapters[index]
      const t = now() - enteredAt
      const acts = ch.act ?? []
      while (actIdx < acts.length && acts[actIdx][0] <= t) {
        const [, kind] = acts[actIdx]
        actIdx += 1
        deps.applyAction(kind)
        emit({ t: now(), type: 'act', kind })
      }
      const looks = ch.look ?? []
      while (lookIdx < looks.length && looks[lookIdx][0] <= t) {
        const [, id] = looks[lookIdx]
        lookIdx += 1
        deps.focus(id)
        emit({ t: now(), type: 'look', id })
      }
      const ats = ch.at ?? []
      while (atIdx < ats.length && ats[atIdx][0] <= t) {
        const [, knobs] = ats[atIdx]
        atIdx += 1
        deps.setKnobs(knobs)
        emit({ t: now(), type: 'knobs', keys: Object.keys(knobs).sort() })
      }
      if (!armed && t >= ch.duration) {
        armed = true
        if (!ch.yourTurn) turnDone = true
        emit({ t: now(), type: 'armed', index })
      }
    },
    next(): boolean {
      if (!this.canAdvance()) return false
      if (index >= chapters.length - 1) {
        this.stop('finished')
        return true
      }
      enter(index + 1)
      return true
    },
    prev(): void {
      if (!running || index === 0) return
      enter(index - 1)
    },
    goTo(i: number): void {
      if (!running || i < 0 || i >= chapters.length) return
      enter(i)
    },
    satisfy(how = 'performed'): void {
      if (!running || turnDone) return
      turnDone = true
      turnSkipped = how === 'skipped'
      emit({ t: now(), type: 'your-turn-done', index, how })
    },
    stop(reason = 'closed'): void {
      if (!running) return
      running = false
      emit({ t: now(), type: 'stop', reason })
    },
  }
}
