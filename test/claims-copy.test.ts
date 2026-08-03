/* Claims-spine enforcement for copy surfaces (the M3 gate).
 *
 * Mechanism (pragmatic, documented): copy files may state a Kubernetes
 * default ONLY via ${...} interpolation from CLAIM_VALUES. We strip every
 * template interpolation from the source and then assert that no known
 * claim value survives as a bare literal in what remains. This catches the
 * failure that matters — retyping a number where it can drift — without
 * banning innocent digits (stop indices, CSS sizes).
 *
 * Copy surfaces grow by glob: add a file here when it starts speaking.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../src/core/claims'
import { TRACE_COPY } from '../src/ui/trace-copy'
import { presentedStages } from '../src/core/trace-presentation'
import type { TraceRecord } from '../src/core/types'

const COPY_SOURCES = ['../src/ui/trace-copy.ts', '../src/sim/scenarios.ts', '../src/ui/tour.ts']

/**
 * The numbers that must never be retyped into copy, each with the CONTEXT
 * pattern that identifies a claim statement (so a model constant like
 * "quorum 2 of 3 chambers" is not confused with failureThreshold 3).
 */
const GUARDED: { value: number; pattern: RegExp; claim: string }[] = [
  {
    value: CLAIM_VALUES.probes.periodSeconds,
    pattern: /\bevery\s+10\b|\b10\s*(model\s*)?s(ec|econds)?\b/,
    claim: 'probes.periodSeconds',
  },
  {
    value: CLAIM_VALUES.probes.failureThreshold,
    pattern: /×\s*3\b|threshold\s+3\b|\b3\s+(failures|strikes|visits)\b/,
    claim: 'probes.failureThreshold',
  },
  {
    value: CLAIM_VALUES.tolerations.defaultSeconds,
    pattern: /\b300\s*(model\s*)?s(ec|econds)?\b/,
    claim: 'tolerations.defaultSeconds',
  },
  {
    value: CLAIM_VALUES.termination.defaultGraceSeconds,
    pattern: /grace[^.]{0,16}\b30\b|\b30[-\s]*(model\s*)?s(ec|econds)?\b/,
    claim: 'termination.defaultGraceSeconds',
  },
  {
    value: CLAIM_VALUES.crashLoop.capSeconds,
    pattern: /cap[^.]{0,12}\b300\b/,
    claim: 'crashLoop.capSeconds',
  },
  {
    value: CLAIM_VALUES.nodeMonitor.graceSeconds,
    pattern: /\b50[-\s]*(model\s*)?s(ec|econds)?\b/,
    claim: 'nodeMonitor.graceSeconds',
  },
]

function strippedSource(rel: string): string {
  const raw = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  // remove ${...} interpolations (non-nested is enough for copy files)
  return raw.replace(/\$\{[^}]*\}/g, '⟨claim⟩')
}

describe('claims-spine: copy surfaces', () => {
  for (const src of COPY_SOURCES) {
    it(`${src} states guarded defaults only through CLAIM_VALUES`, () => {
      const stripped = strippedSource(src)
      // Only inspect string-literal content: crude but effective — template
      // and quoted strings are where copy lives.
      const strings = stripped.match(/(['"`])(?:\\.|(?!\1).)*\1/g) ?? []
      const text = strings.join('\n')
      for (const g of GUARDED) {
        const hit = text.match(g.pattern)
        expect(
          hit,
          `retyped claim ${g.claim} (${g.value}) in ${src}: "${hit?.[0] ?? ''}" — interpolate CLAIM_VALUES instead`,
        ).toBeNull()
      }
    })
  }

  it('every trace stop renders non-empty copy against a synthetic record', () => {
    const t: TraceRecord = {
      action: 'apply-deployment',
      playback: 'step',
      stop: 'client',
      visited: 1,
      startedAt: 0,
      stopAt: 12,
      trips: 9,
      rev: 41,
      commitRev: 12,
      scannedRev: 41,
      familyUids: ['u1'],
      subject: 'shopfront',
      mutations: ['probes defaulted', 'tolerations injected', 'grace defaulted'],
      watchersNotified: 4,
      watchersTotal: 7,
      maxBacklog: 2,
      queuePos: 1,
      pendingPods: 3,
      filter: [{ node: 'node-a', ok: true }],
      score: [{ node: 'node-a', leastAllocated: 90, imageLocality: 50, spread: 100 }],
      chosen: 'node-a',
      kubeletGapRev: 3,
      syncQueueDepth: 1,
      pullDoneMB: 90,
      pullTotalMB: 180,
      pullWaitSec: 1.5,
      layersHit: 4,
      layersTotal: 6,
      pullSkipped: false,
      pullSeen: true,
      restarts: 0,
      readyOks: 1,
      nextProbeInSec: 4.2,
      serviceListed: false,
      desiredReplicas: 3,
      familyPods: 3,
      siblingsAtStop: 2,
      rsCreated: true,
      eventsSince: 14,
      autoPaused: false,
      savedKnobs: {} as TraceRecord['savedKnobs'],
    }
    for (const stage of presentedStages('apply-deployment')) {
      const copy = TRACE_COPY[stage.stop]
      expect(copy.title.length, stage.stop).toBeGreaterThan(4)
      expect(copy.body(t).length, stage.stop).toBeGreaterThan(20)
      expect(copy.line(t).length, stage.stop).toBeGreaterThan(4)
    }
  })
})
