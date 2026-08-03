/* The flagship trace's voice — one entry per stop.
 *
 * Copy discipline (CLAUDE.md, enforced by test/claims-copy.test.ts): every
 * Kubernetes default stated here is interpolated from CLAIM_VALUES, never
 * typed as a literal. Counter lines read the live TraceRecord. Registers
 * never mix inside a line: civic for the control plane, nautical only at
 * the harbor.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { TraceRecord, TraceStop } from '../core/types'

export interface TraceStopCopy {
  title: string
  body(t: TraceRecord): string
  /** the mono counter line under the prose — live evidence, not adjectives */
  line(t: TraceRecord): string
  hint?: string
}

const P = CLAIM_VALUES.probes
const TOL = CLAIM_VALUES.tolerations
const GRACE = CLAIM_VALUES.termination
const UNIT = CLAIM_VALUES.modelDuration.shortUnit

function letterOf(node: string | undefined): string | null {
  return node && node.startsWith('node-') ? node.slice('node-'.length) : null
}

export const TRACE_COPY: Record<TraceStop, TraceStopCopy> = {
  client: {
    title: 'You are just a client',
    body: () =>
      'kubectl does very little. It reads your manifest, opens a connection to City Hall, and files the paper at the permit desk — one client among many, with no special standing.',
    line: (t) => `API round trips ${t.trips} · the city has not been told anything yet`,
    hint: 'Next walks the journey stop by stop; Esc hands the city back.',
  },
  admission: {
    title: 'The desk finishes your manifest',
    body: () =>
      'Every default you did not write is stamped in ink you can read: probe timings, eviction tolerances, a demolition notice period. Nothing is executed here — your intention is only completed.',
    line: (t) =>
      `${t.mutations.length} defaults stamped · probes every ${P.periodSeconds}${UNIT} ×${P.failureThreshold} · tolerations ${TOL.defaultSeconds}${UNIT} · grace ${GRACE.defaultGraceSeconds}${UNIT}`,
  },
  etcd_commit: {
    title: 'The cluster is a ledger',
    body: (t) =>
      `Your ${t.action === 'apply-deployment' ? 'Deployment' : 'Pod'} is now a revision in the vault — a row, nothing more. No machine has been told to do anything. The truth changed; that is all that ever happens here.`,
    line: (t) => `revision ${t.commitRev} · quorum 2 of 3 chambers · trips ${t.trips}`,
  },
  watch_fanout: {
    title: 'Everyone finds out the same way',
    body: () =>
      'The board over the south door flips, and couriers leave for every office that subscribed — zoning, the inspectors, every district foreman. One commit, many roads. Nobody is told first, on purpose.',
    line: (t) => `couriers delivered ${t.watchersNotified}/${t.watchersTotal} · deepest satchel ${t.maxBacklog}`,
  },
  deploy_reconcile: {
    title: 'The HQ desk reads the ledger, not your intentions',
    body: (t) =>
      `Desired: ${t.desiredReplicas} shops. Standing: none. The desk files a construction contract — a ReplicaSet — and the filing goes back through the permit hall like everything else. Inspectors never visit the street.`,
    line: (t) => `desired ${t.desiredReplicas} · observed 0 · ReplicaSet filed · trips ${t.trips}`,
  },
  rs_reconcile: {
    title: 'The contract desk files the difference',
    body: (t) =>
      `It counts what stands, compares the contract, and files permits for what is missing. You wrote one paper; the desks have now written ${Math.max(0, t.trips - 1)} more. That climbing number is the whole architecture.`,
    line: (t) => `pods filed ${t.familyPods}/${t.desiredReplicas} · family trips ${t.trips}`,
  },
  sched_queue: {
    title: 'Pending means unassigned',
    body: (t) =>
      `A Pod without a district is a blueprint without an address. It waits in zoning's inbox${t.siblingsAtStop > 0 ? ' alongside its siblings' : ''}, and nothing builds until zoning says where.`,
    line: (t) => `queue position ${t.queuePos > 0 ? t.queuePos : '—'} · pods pending ${t.pendingPods}`,
  },
  filter_score: {
    title: 'Strike out, then grade',
    body: () =>
      'Districts that cannot hold the building are struck: no power budget, a taint the blueprint does not tolerate, a cordon. Survivors are graded — spare capacity, the container already on the shelf, siblings kept apart.',
    line: (t) => {
      if (!t.filter) return 'graded off-camera — the verdict is already in the ledger'
      const passed = t.filter.filter((f) => f.ok).length
      const win = t.score?.find((s) => s.node === t.chosen)
      const detail = win
        ? ` (capacity ${win.leastAllocated} · shelf ${win.imageLocality} · spread ${win.spread})`
        : ''
      return `${passed}/${t.filter.length} districts pass · winner ${t.chosen ?? '…'}${detail}`
    },
  },
  bind: {
    title: 'Binding is just another write',
    body: () =>
      'Zoning does not phone the foreman. It files the chosen address back into the ledger — one more trip through the hall — and trusts the couriers with the rest.',
    line: (t) => `nodeName ${t.chosen ?? '…'} · revision ${t.rev} · trips ${t.trips}`,
  },
  kubelet_sees: {
    title: 'The foreman reads the ledger too',
    body: (t) =>
      `The courier reaches ${t.chosen ?? 'the district'}'s office. The foreman checks the address, sees the building is theirs, and opens a work file. Nothing upstream knows this happened — or needs to.`,
    line: (t) => `courier gap ${t.kubeletGapRev} revisions · sync queue ${t.syncQueueDepth}`,
  },
  image_pull: {
    title: 'Cargo from the harbor',
    body: (t) =>
      t.pullSkipped
        ? 'Not needed this time: the district already had the container on the shelf, so the crane never moved. This is what an image cache buys.'
        : 'The container is not on the shelf, so the crane engages. Pulls are one at a time per district — anything else in line waits on the quay.',
    line: (t) =>
      t.pullSkipped
        ? 'image cached · 0 MB pulled'
        : `${t.pullDoneMB.toFixed(0)}/${t.pullTotalMB.toFixed(0)} MB · layers cached ${t.layersHit}/${t.layersTotal} · waited ${t.pullWaitSec.toFixed(1)}${UNIT}`,
  },
  start_probes: {
    title: 'Running is not ready',
    body: () =>
      `The doors are on and the lights work. Now an inspector visits every ${P.periodSeconds} ${CLAIM_VALUES.modelDuration.prose} seconds — and until a visit passes, no directory anywhere will list this building.`,
    line: (t) =>
      `restarts ${t.restarts} · readiness passes ${t.readyOks} · next visit in ${t.nextProbeInSec.toFixed(1)}${UNIT}`,
  },
  endpoints: {
    title: 'Listed — or unlisted',
    body: (t) =>
      t.serviceListed
        ? 'The directory board updates: this door is open, route traffic here.'
        : 'Running, and no number lists it. The building is open and healthy — and unreachable by name, because no Service claims it. A Pod owns no phone number; that is a different object entirely.',
    line: (t) => (t.serviceListed ? 'listed · ready' : 'ready · Services listing it: 0'),
  },
  done: {
    title: 'One row, many hops',
    body: (t) =>
      `Your manifest became ${t.trips} trips through the permit hall and ${t.eventsSince} lines in the newspaper. Nothing spoke to anything directly. That is the entire trick, and the rest of Kubernetes is special cases of it.`,
    line: (t) =>
      `trips ${t.trips} · elapsed ${(t.stopAt - t.startedAt).toFixed(1)}${UNIT} · events ${t.eventsSince}`,
    hint: 'Try the Deployment next — one paper that becomes four.',
  },
}

/** Where the camera goes at each stop. */
export function traceFocusId(stop: TraceStop, t: TraceRecord): string {
  const letter = letterOf(t.chosen)
  switch (stop) {
    case 'client': return 'client.terminal'
    case 'admission': return 'cityhall.permitdesk'
    case 'etcd_commit': return 'records.vault'
    case 'watch_fanout': return 'cityhall.watchboard'
    case 'deploy_reconcile': return 'inspectors.desk.deployment'
    case 'rs_reconcile': return 'inspectors.desk.replicaset'
    case 'sched_queue': return 'zoning.office'
    case 'filter_score': return 'zoning.maptable'
    case 'bind': return 'records.vault'
    case 'kubelet_sees': return letter ? `node.${letter}.foreman` : 'zoning.office'
    case 'image_pull': return t.pullSkipped && letter ? `node.${letter}.signage` : 'harbor.crane'
    case 'start_probes': return t.chosen ?? 'overview.balloon'
    case 'endpoints': return 'service.directory'
    case 'done': return 'overview.balloon'
  }
}
