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
      `${t.mutations.length} defaults stamped · probes every ${P.periodSeconds} ${UNIT} ×${P.failureThreshold} · tolerations ${TOL.defaultSeconds} ${UNIT} · grace ${GRACE.defaultGraceSeconds} ${UNIT}`,
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
        : `${t.pullDoneMB.toFixed(0)}/${t.pullTotalMB.toFixed(0)} MB · layers cached ${t.layersHit}/${t.layersTotal} · waited ${t.pullWaitSec.toFixed(1)} ${UNIT}`,
  },
  start_probes: {
    title: 'Running is not ready',
    body: () =>
      `The doors are on and the lights work. Now an inspector visits every ${P.periodSeconds} ${CLAIM_VALUES.modelDuration.prose} seconds — and until a visit passes, no directory anywhere will list this building.`,
    line: (t) =>
      `restarts ${t.restarts} · readiness passes ${t.readyOks} · next visit in ${t.nextProbeInSec.toFixed(1)} ${UNIT}`,
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
      `trips ${t.trips} · elapsed ${(t.stopAt - t.startedAt).toFixed(1)} ${UNIT} · events ${t.eventsSince}`,
    hint: 'Try the Deployment next — one paper that becomes four.',
  },

  /* -- delete rail (M6). Ordering is the content. -- */
  endpoint_withdraw: {
    title: 'The directory withdraws the door',
    body: (t) =>
      t.trafficLive
        ? 'The directory desk saw the notice and filed a new edition without this door. Every district signage now has to copy it — one courier each, none of them first.'
        : 'No caller was ever routed here: no directory listed this door, so there is nothing to withdraw. With a Service and live traffic, this stop is a race you can lose.',
    line: (t) =>
      t.trafficLive
        ? `districts updated ${t.districtsProgrammed}/${t.districtsTotal} · misrouted so far ${t.misroutedSince}`
        : 'no Service listed this pod · misrouted 0',
  },
  sigterm: {
    title: 'The foreman knocks',
    body: (t) =>
      t.savedKnobs.preStopSleepSec > 0
        ? `Before the knock, the building got its preStop window — ${t.savedKnobs.preStopSleepSec} ${UNIT} of answering calls while the directories caught up. The countdown was already running: the window spends the grace period, it does not extend it.`
        : 'SIGTERM lands the moment the foreman reads the notice. The withdrawal is still propagating on other roads — callers the signage still routes here now reach a door that has stopped answering.',
    line: (t) =>
      `SIGTERM at ${t.sigtermLandedAt.toFixed(1)} ${UNIT} · withdrawal ${t.withdrawRev > 0 ? 'filed' : 'in flight'} · misrouted ${t.misroutedSince}`,
  },
  grace_countdown: {
    title: 'The grace period is a deadline, not a courtesy',
    body: () =>
      `The app has ${GRACE.defaultGraceSeconds} ${UNIT} from the notice — not from the knock — to finish its work and leave. A well-behaved app exits early; the backstop exists for the other kind.`,
    line: (t) => `grace remaining ${t.graceRemainingSec.toFixed(1)} ${UNIT} · backstop armed`,
  },
  sigkill: {
    title: 'The backstop',
    body: (t) =>
      t.cleanExit
        ? 'Not needed — the app exited clean, well inside its grace. SIGKILL is the tool the city hopes never to use.'
        : 'The grace expired with the app still standing, so the kernel ends it. Nothing negotiates with SIGKILL.',
    line: (t) => (t.cleanExit ? 'exited clean · SIGKILL skipped' : 'SIGKILL delivered · exit forced'),
  },
  rs_notices: {
    title: 'The desk never mourns',
    body: (t) =>
      t.replicaSetUid
        ? `The contract still says ${t.desiredReplicas || 'N'}; the street now counts one fewer. The desk files a replacement permit before the rubble settles — grief is not in its instruction set.`
        : 'This building had no owner. No contract counts it, so nothing files a replacement — deleted means gone.',
    line: (t) =>
      t.replicaSetUid
        ? `replacement ${t.replacementName || '…'} filed · trips ${t.trips}`
        : 'no owner · no replacement',
  },

  /* -- CRD rails (M7). A law with no inspector is paper. -- */
  operator: {
    title: 'Somebody must hold this watch',
    body: (t) =>
      t.operatorStaffed
        ? 'The shack is staffed. Its courier walks the longest road in the city — an operator is an ordinary client, far from the control plane, reading the same ledger as every desk and filing the same paperwork back.'
        : 'Nothing happens. The row exists, revisioned and real — and no office holds this watch. Built-in kinds come with inspectors; a custom kind is reconciled only while someone runs its operator.',
    line: (t) =>
      t.operatorStaffed
        ? `shack staffed · reconciles ${t.operatorReconciles} · ${t.beaconBuilt ? 'tower standing' : 'construction filed'}`
        : 'shack dark · reconciles 0 · the row waits',
    hint: 'The stop holds here until the beacon lights. Staffing the shack is the fix.',
  },
  beacon: {
    title: 'Reconciliation is an occupation',
    body: () =>
      'The tower stands and the beam sweeps. Fuel drains from this moment on, and only the shack corrects it — refuel runs leave the docks whenever the watch notices the gauge. Unstaff the operator and the breakwater goes dark again.',
    line: (t) => `lit · fuel ${t.beaconFuelPct}% · reconciles ${t.operatorReconciles}`,
  },
}

/** Delete-rail overrides for the stops the rails share. */
const DELETE_COPY: Partial<Record<TraceStop, TraceStopCopy>> = {
  client: {
    title: 'You are just a client',
    body: (t) =>
      `kubectl asks City Hall to delete ${t.subject}. It does not visit the district, and it will not swing the wrecking ball — it files a request, like every other request.`,
    line: (t) => `victim ${t.subject} · misrouted before this: ${t.misroutedAtStart}`,
    hint: 'Watch the misroute counter — this rail is about a race.',
  },
  etcd_commit: {
    title: 'A notice, not a demolition',
    body: () =>
      `Delete does not remove the row. It stamps a demolition notice — deletionTimestamp — and grants ${GRACE.defaultGraceSeconds} ${UNIT} of grace. The building still stands; the truth now says it is leaving.`,
    line: (t) => `notice at revision ${t.deleteRev} · grace ${GRACE.defaultGraceSeconds} ${UNIT} · trips ${t.trips}`,
  },
  watch_fanout: {
    title: 'Two couriers, one moment, no order',
    body: () =>
      'The notice fans out like every commit. The directory desk gets a copy; the district foreman gets a copy — at the SAME moment, on different roads, and nothing anywhere orders their arrival. Everything that goes wrong next comes from that sentence.',
    line: (t) => `couriers delivered ${t.watchersNotified}/${t.watchersTotal} · deepest satchel ${t.maxBacklog}`,
  },
  done: {
    title: 'The race, on paper',
    body: (t) =>
      t.trafficLive
        ? t.misroutedSince > 0
          ? `${t.misroutedSince} callers reached a door that had stopped answering, because withdrawal and shutdown raced and shutdown won. A preStop sleep longer than the propagation — about ${t.suggestedPreStopSec} ${UNIT} here — keeps the door answering while the directories catch up.`
          : 'Zero callers lost: the door kept answering through its preStop window while every directory caught up. This is the fix, working.'
        : 'No traffic flowed, so the race had no victims this time. Apply a Service, put callers on the road, and run this rail again.',
    line: (t) =>
      `misrouted ${t.misroutedSince} · replacement ${t.replacementName || '—'} · trips ${t.trips} · elapsed ${(t.stopAt - t.startedAt).toFixed(1)} ${UNIT}`,
    hint: 'Try the fix: re-run with a preStop sleep longer than the propagation.',
  },
}

/** CRD-rail overrides: the same hall, a different kind of paper. */
const CRD_COPY: Partial<Record<TraceStop, TraceStopCopy>> = {
  client: {
    title: 'You are proposing a law',
    body: () =>
      'This manifest defines no building. It teaches City Hall a new FORM — a kind called Lighthouse — that permits may cite from now on. kubectl files it like any other paper.',
    line: (t) => `CustomResourceDefinition · trips ${t.trips}`,
  },
  admission: {
    title: 'The desk reads the law itself',
    body: () =>
      'A CustomResourceDefinition is validated like anything else — the desk checks the group, the kind, the shape of the form it will hand out later. No special hall for laws.',
    line: (t) => `${t.mutations.length} defaults stamped · group harbor.city · kind Lighthouse`,
  },
  watch_fanout: {
    title: 'Every office is told — none of them care yet',
    body: () =>
      'The couriers go out like always. Zoning shrugs; the foremen shrug; no desk anywhere subscribes to Lighthouses. The law is now in force, and it changes nothing by itself.',
    line: (t) => `couriers delivered ${t.watchersNotified}/${t.watchersTotal} · offices that will act: 0`,
  },
  done: {
    title: 'A law is not a building',
    body: () =>
      'City Hall opens a new counter window: permits of kind Lighthouse are now accepted at the desk. That is the entire consequence. Somebody still has to file one — and somebody else has to care.',
    line: (t) => `kind registered · trips ${t.trips} · elapsed ${(t.stopAt - t.startedAt).toFixed(1)} ${UNIT}`,
    hint: 'Now apply the Lighthouse itself — and watch what does NOT happen.',
  },
}

/** Lighthouse-rail overrides: the permit that cites the new law. */
const LIGHTHOUSE_COPY: Partial<Record<TraceStop, TraceStopCopy>> = {
  client: {
    title: 'A permit citing a brand-new law',
    body: () =>
      'kind: Lighthouse — a form City Hall did not know last week. If the law is on the books, this files like any Pod. If it is not, the desk will say so in as many words.',
    line: (t) => `kind Lighthouse · CRD registered: ${t.crdMatched ? 'yes' : 'no'}`,
  },
  admission: {
    title: 'The desk checks the register',
    body: (t) =>
      t.crdMatched
        ? 'Validation finds the law: lighthouses.harbor.city, registered and accepted. The form is legal; the permit passes like any built-in kind.'
        : 'Validation checks the register for a law that permits this kind — and this is where the paper stops if the council never passed one.',
    line: (t) => (t.crdMatched ? 'kind registered: lighthouses.harbor.city' : 'checking the register…'),
  },
  etcd_commit: {
    title: 'A custom row is still a row',
    body: () =>
      'The vault does not distinguish. Your Lighthouse is a revision in the same ledger as every Pod and every Node — same quorum, same stamp, same truth.',
    line: (t) => `revision ${t.commitRev} · quorum 2 of 3 chambers · trips ${t.trips}`,
  },
  done: {
    title: 'The whole lesson on one receipt',
    body: (t) =>
      t.rejectedError !== ''
        ? `The desk refused it: "${t.rejectedError}". A permit cannot cite a law that was never passed — apply the CustomResourceDefinition first, then file this again.`
        : 'Built-in kinds come with inspectors. Yours gets one only if you run it — and keeps it only while you keep it running. That is the operator pattern, whole.',
    line: (t) =>
      t.rejectedError !== ''
        ? 'rejected at validation · nothing was stored'
        : `lit · fuel ${t.beaconFuelPct}% · reconciles ${t.operatorReconciles} · trips ${t.trips}`,
    hint: 'Unstaff the shack from its inspector panel and watch the fuel gauge.',
  },
}

/** Rail-aware copy: each rail overrides the stops the rails share. */
export function traceCopyFor(t: TraceRecord, stop: TraceStop): TraceStopCopy {
  if (t.action === 'delete-pod') {
    const override = DELETE_COPY[stop]
    if (override) return override
  }
  if (t.action === 'apply-crd') {
    const override = CRD_COPY[stop]
    if (override) return override
  }
  if (t.action === 'apply-lighthouse') {
    const override = LIGHTHOUSE_COPY[stop]
    if (override) return override
  }
  return TRACE_COPY[stop]
}

/** Where the camera goes at each stop (registered component ids only). */
export function traceFocusId(stop: TraceStop, t: TraceRecord): string {
  const letter = letterOf(t.chosen)
  switch (stop) {
    case 'client': return 'overview.balloon' // the establishing shot: one client, whole city
    case 'admission': return 'cityhall.permitdesk'
    case 'etcd_commit': return 'records.vault'
    case 'watch_fanout': return 'cityhall.watchboard'
    case 'deploy_reconcile': return 'inspectors.desk.deployment'
    case 'rs_reconcile': return 'inspectors.desk.replicaset'
    case 'sched_queue': return 'zoning.office'
    case 'filter_score': return 'zoning.maptable'
    case 'bind': return 'records.vault'
    case 'kubelet_sees': return letter ? `node.${letter}.foreman` : 'zoning.office'
    case 'image_pull': return t.pullSkipped && letter ? `node.${letter}.foreman` : 'harbor.crane'
    case 'start_probes': return letter ? `node.${letter}.watertower` : 'overview.balloon'
    // With a Service standing, the directory board takes this stop over (M6).
    case 'endpoints': return t.serviceListed ? 'service.directory' : 'overview.balloon'
    /* -- delete rail: the camera follows the actual building where it can -- */
    case 'endpoint_withdraw': return t.trafficLive ? 'service.directory' : 'overview.balloon'
    case 'sigterm': return 'pod.traced'
    case 'grace_countdown': return 'pod.traced'
    case 'sigkill': return 'pod.traced'
    case 'rs_notices': return 'inspectors.desk.replicaset'
    /* -- CRD rails: the shack and the breakwater -- */
    case 'operator': return 'operator.shack'
    case 'beacon': return 'harbor.lighthouse'
    case 'done':
      if (t.action === 'delete-pod') return 'service.junction'
      if (t.action === 'apply-crd') return 'cityhall.permitdesk'
      if (t.action === 'apply-lighthouse') {
        return t.rejectedError !== '' ? 'cityhall.permitdesk' : 'harbor.lighthouse'
      }
      return 'overview.balloon'
  }
}
