/* ============================================================================
 * Kubetropolis — shared contracts.
 *
 * Derived from PGSimCity src/core/types.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Rewritten at M1: the simulation contract is now the
 * Kubernetes control plane; the engine/UI surface (bus, registry, world
 * modules, theme, camera, routes, docs, tours, scenarios) is carried forward
 * from upstream. A quarantined TV-legacy block at the bottom keeps the
 * temporarily-verbatim Postgres world files compiling until M2 replaces them.
 *
 * Everything in this file is API surface consumed by more than one module.
 * The simulation (src/sim) never imports three.js; the world (src/world)
 * never mutates simulation state. They meet here.
 * ==========================================================================*/

import type * as THREE from 'three'
import { CLAIM_VALUES } from './claims'

/* ===========================================================================
 * THE KUBERNETES CONTRACT (M1)
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * Objects — everything in the cluster is a row in the ledger.
 * -------------------------------------------------------------------------*/

export type Uid = string

export type Kind =
  | 'Pod'
  | 'Node'
  | 'Deployment'
  | 'ReplicaSet'
  | 'Service'
  | 'EndpointSlice'
  | 'Namespace'
  | 'HorizontalPodAutoscaler'
  | 'PodDisruptionBudget'
  | 'Lease'
  | 'CustomResourceDefinition'
  | 'Lighthouse'
  | 'ResourceQuota'

export interface ObjMeta {
  uid: Uid
  kind: Kind
  name: string
  namespace: string
  /** etcd revision of the last committed write to this object */
  resourceVersion: number
  /**
   * Bumps on ANY spec change — the server owns it (a scale bumps it too).
   * What a scale does NOT do is change the pod template, so no new
   * pod-template-hash, no new ReplicaSet, no rollout revision.
   */
  generation: number
  labels: Record<string, string>
  /** single-owner simplification of ownerReferences */
  ownerUid?: Uid
  finalizers: string[]
  /** model seconds; set ⇒ the object is terminating */
  deletionTimestamp?: number
}

export interface ProbeSpec {
  periodSeconds: number
  failureThreshold: number
  successThreshold: number
  initialDelaySeconds: number
}

export type TaintEffect = 'NoSchedule' | 'NoExecute'

export interface Toleration {
  key: string
  /** absent = tolerates the key regardless of effect (real: empty effect) */
  effect?: TaintEffect
  seconds?: number
}

export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown'

export type ContainerRunState =
  | 'waiting'
  | 'pulling'
  | 'creating'
  | 'running'
  | 'terminating'
  | 'terminated'

export type ContainerReason =
  | 'ContainerCreating'
  | 'ErrImagePull'
  | 'ImagePullBackOff'
  | 'CrashLoopBackOff'
  | 'OOMKilled'
  | 'Completed'
  | 'Error'

export interface PodObj extends ObjMeta {
  kind: 'Pod'
  spec: {
    nodeName?: string
    image: string
    initImage?: string
    imagePullPolicy?: 'Always' | 'IfNotPresent'
    requests: { cpuM: number; memMi: number }
    limitMemMi: number
    /** terminationGracePeriodSeconds (default stamped by admission) */
    tgps: number
    tolerations: Toleration[]
    probes: { readiness: ProbeSpec; liveness: ProbeSpec }
    /** THE delete-race teaching knob */
    preStopSleepSec: number
  }
  status: {
    phase: PodPhase
    ready: boolean
    scheduledAt?: number
    startedAt?: number
    container: {
      state: ContainerRunState
      reason?: ContainerReason
      restartCount: number
      /** current backoff rung in model seconds (10 → 20 → … → 300) */
      backoffSec: number
      backoffUntil?: number
      exitCode?: number
      /**
       * Why the LAST run ended (real: lastState.terminated.reason) — kubectl
       * flickers OOMKilled, then settles on the waiting reason CrashLoopBackOff.
       */
      lastExitReason?: 'Error' | 'OOMKilled'
      /** current working-set estimate, model MiB */
      memMi: number
    }
  }
}

export interface ReplicaSetObj extends ObjMeta {
  kind: 'ReplicaSet'
  spec: {
    replicas: number
    /** identifies the template generation; keeps sibling RSes disjoint */
    podTemplateHash: string
    template: { image: string; requests: { cpuM: number; memMi: number }; limitMemMi: number }
  }
  status: { observed: number; ready: number }
}

export interface DeploymentObj extends ObjMeta {
  kind: 'Deployment'
  spec: {
    replicas: number
    template: { image: string; requests: { cpuM: number; memMi: number }; limitMemMi: number }
    maxSurgePct: number
    maxUnavailablePct: number
  }
  status: {
    observed: number
    ready: number
    updated: number
    /** the generation this desk has processed — "has the controller seen my change" */
    observedGeneration: number
  }
}

export interface NodeCondition {
  type: 'Ready'
  /** tri-state like the real condition: heartbeat loss ⇒ Unknown, not False */
  status: 'True' | 'False' | 'Unknown'
  /** model seconds of the last transition */
  since: number
}

export interface NodeObj extends ObjMeta {
  kind: 'Node'
  spec: { unschedulable?: boolean; taints: { key: string; effect: TaintEffect }[] }
  status: {
    conditions: NodeCondition[]
    allocatable: { cpuM: number; memMi: number }
  }
}

export interface LeaseObj extends ObjMeta {
  kind: 'Lease'
  spec: { holder: string; durationSeconds: number; renewedAt: number }
}

export interface ServiceObj extends ObjMeta {
  kind: 'Service'
  spec: {
    selector: Record<string, string>
    port: number
    /** the ingress hostname routed to this service (M6 single-service model) */
    ingressHost?: string
  }
  status: Record<string, never>
}

/** One door in the directory. */
export interface EndpointEntry {
  podUid: Uid
  podName: string
  nodeName: string
  conditions: {
    /** serving ∧ ¬terminating — what proxies route to (claims: slice.conditions) */
    ready: boolean
    serving: boolean
    terminating: boolean
  }
}

/**
 * FIDELITY: real EndpointSlices carry `endpoints`/`ports` at top level with a
 * separate status; the model folds endpoints into spec so the standard
 * update-merge semantics (and generation, which bumps on real change only)
 * apply unchanged.
 */
export interface EndpointSliceObj extends ObjMeta {
  kind: 'EndpointSlice'
  spec: {
    serviceUid: Uid
    endpoints: EndpointEntry[]
  }
  status: Record<string, never>
}

/**
 * A CRD teaches City Hall a new form. Registration is schema-only — no
 * controller appears, no building rises. A law is not a building (M7).
 * Model boundary: kind-match only — no OpenAPI schema, versions, or
 * conversion (FIDELITY.md).
 */
export interface CustomResourceDefinitionObj extends ObjMeta {
  kind: 'CustomResourceDefinition'
  spec: {
    group: string
    /** the kind this CRD registers (the model's one custom kind) */
    names: { kind: 'Lighthouse'; plural: string }
  }
  status: { accepted: boolean }
}

/**
 * The custom resource. Spec is the reader's ask; status is written ONLY by
 * the operator — when nobody staffs the shack, status goes stale while the
 * physical beacon (SimState.beacon, street truth) drifts. That gap IS the
 * lesson.
 */
export interface LighthouseObj extends ObjMeta {
  kind: 'Lighthouse'
  spec: {
    beamRpm: number
    rangeM: number
  }
  status: {
    lit: boolean
    fuelPct: number
    lastMaintainedAt?: number
  }
}

/** The kinds the model actually stores. Later milestones extend this. */
/** The autoscaler desk's charter (M8). One HPA, targeting the demo Deployment. */
export interface HpaObj extends ObjMeta {
  kind: 'HorizontalPodAutoscaler'
  spec: { targetDeployment: string; targetCpuPct: number; min: number; max: number }
  status: {
    currentUtilizationPct: number
    desired: number
    /** the desk's paper spike: recommendations inside the stabilization window */
    recommendations: { at: number; desired: number }[]
    lastScaleAt?: number
  }
}

/** A promise you made to stay available (M8). Guards EVICTIONS, not deletes. */
export interface PdbObj extends ObjMeta {
  kind: 'PodDisruptionBudget'
  spec: { selector: Record<string, string>; minAvailable: number }
  status: { blockedEvictions: number }
}

/** The neighborhood permit cap (M8): counts objects, not intentions. */
export interface QuotaObj extends ObjMeta {
  kind: 'ResourceQuota'
  spec: { hardPods: number }
  status: { usedPods: number }
}

export type K8sObject =
  | PodObj
  | ReplicaSetObj
  | DeploymentObj
  | NodeObj
  | LeaseObj
  | ServiceObj
  | EndpointSliceObj
  | CustomResourceDefinitionObj
  | LighthouseObj
  | HpaObj
  | PdbObj
  | QuotaObj

/* ---------------------------------------------------------------------------
 * Watch machinery — state moves ONLY as watch events.
 * -------------------------------------------------------------------------*/

export type WatchEventType = 'ADDED' | 'MODIFIED' | 'DELETED'

export interface WatchEvent {
  type: WatchEventType
  object: K8sObject
}

export interface ChangeRecord {
  rev: number
  op: 'put' | 'delete'
  uid: Uid
  kind: Kind
  /** watch-event classification computed at commit time */
  event: WatchEventType
}

/* ---------------------------------------------------------------------------
 * etcd — the vault. Quorum, fsync, revisions, compaction. Honestly simplified.
 * -------------------------------------------------------------------------*/

export interface PendingWrite {
  req: ApiRequest
  acks: number
  /** model time at which quorum+fsync completes and the write commits */
  readyAt: number
}

export interface EtcdState {
  revision: number
  compactedRevision: number
  /** committed change log; trimmed by compaction */
  log: ChangeRecord[]
  /** materialized current state — THE cluster */
  objects: Map<Uid, K8sObject>
  members: { id: 0 | 1 | 2; healthy: boolean }[]
  leader: 0 | 1 | 2
  /** effective fsync latency, model ms (base + chaos) */
  fsyncMs: number
  proposals: PendingWrite[]
  nextCompactionAt: number
  /**
   * Revision at the PREVIOUS compaction sweep — kube-apiserver compacts to
   * the interval-ago revision, retaining ~one interval of watchable history.
   */
  lastIntervalRevision: number
}

/* ---------------------------------------------------------------------------
 * API server — the only doorway. Admission advances one stage per tick.
 * -------------------------------------------------------------------------*/

/**
 * 'update' merges spec/labels/generation onto the CURRENT object;
 * 'updateStatus' merges only status (the status-subresource split that stops
 * a stale status write from resurrecting an old spec — see FIDELITY.md);
 * 'delete' stamps deletionTimestamp on scheduled pods (graceful) or removes;
 * 'remove' is the kubelet's final act after termination.
 */
export type ApiVerb = 'create' | 'update' | 'updateStatus' | 'delete' | 'remove' | 'evict'

export type AdmissionStage = 'authn' | 'mutating' | 'quota' | 'validating' | 'toEtcd'

export type ComponentId = string

export interface ApiRequest {
  verb: ApiVerb
  obj: K8sObject
  source: ComponentId
  stage: AdmissionStage
  /** defaults stamped in by the mutating stage — read by trace copy */
  mutations: string[]
}

export interface WatchReg {
  subscriber: ComponentId
  kinds: Kind[]
  /** last revision delivered to this subscriber; lag vs etcd.revision is rendered */
  sentRev: number
  /** committed records waiting out watchLatency before delivery */
  backlog: { rec: ChangeRecord; visibleAt: number }[]
  /**
   * Per-subscriber courier pace (≥1, seeded-random at registration): two
   * watchers observe the same commit at DIFFERENT model times — the fact the
   * delete-race lesson depends on.
   */
  latencyFactor: number
  /** next periodic bookmark (~60 model s); idle watchers advance only then */
  nextBookmarkAt: number
  /** set when compaction outran this watcher; it must relist */
  needsRelist: boolean
  /** a relist is a full LIST — it takes real time, unlike a courier hop */
  relistAt?: number
}

export interface ApiServerState {
  inflight: ApiRequest[]
  rejected: number
  watchers: WatchReg[]
}

/* ---------------------------------------------------------------------------
 * Scheduler — filter, score, bind. Bind is a write, not a construction order.
 * -------------------------------------------------------------------------*/

export interface FilterVerdict {
  node: string
  ok: boolean
  failed?: 'Unschedulable' | 'ResourcesFit' | 'TaintToleration'
}

export interface ScoreEntry {
  node: string
  leastAllocated: number
  imageLocality: number
  spread: number
  total: number
}

export interface SchedCycle {
  podUid: Uid
  filter: FilterVerdict[]
  score: ScoreEntry[]
  chosen?: string
}

export interface SchedulerState {
  /** uids of pending, unassigned pods in arrival order */
  queue: Uid[]
  backoff: { uid: Uid; until: number }[]
  /** last completed cycle, for the overlay and the M3 trace */
  cycle?: SchedCycle
  scheduled: number
  /**
   * Assumed pods — bindings this office has filed that have not yet been
   * observed committed. Counted as occupying their node so back-to-back
   * cycles cannot double-book a district (the real scheduler's reserve/assume
   * cache). Cleared when the bound pod is observed.
   */
  assumed: Map<Uid, string>
}

/* ---------------------------------------------------------------------------
 * Controllers — identical desks: a workqueue and a compare loop.
 * -------------------------------------------------------------------------*/

export type ControllerId =
  | 'deployment'
  | 'replicaset'
  | 'endpointslice'
  | 'nodelifecycle'
  | 'hpa'
  | 'gc'
  | 'lighthouse'

export interface ControllerState {
  id: ControllerId
  workqueue: Uid[]
  sentRev: number
  reconciles: number
  current?: Uid
  nextResyncAt: number
  /** periodic controllers (nodelifecycle, hpa) also wake on a timer */
  nextPeriodicAt?: number
  /**
   * In-flight expectations per reconciled parent — the standard controller
   * trick that stops a desk from re-filing the same create/delete while its
   * previous write is still in the pipeline. Pending child uids are pruned
   * at reconcile time against the desk's own read frame, so counts and
   * expectations always live in ONE temporal frame (mixing frames is how a
   * desk double-counts its own unobserved work and oscillates).
   */
  /**
   * In-flight expectations with a TTL (real ExpectationsTimeout = 5 min): a
   * leaked expectation — a create whose pod was hard-deleted before this
   * desk's next read frame — must expire, never stall the desk forever.
   */
  expect: Map<Uid, { creates: Uid[]; deletes: Uid[]; expiresAt: number }>
}

/* ---------------------------------------------------------------------------
 * Nodes & kubelets — districts and their foremen.
 * -------------------------------------------------------------------------*/

export interface ImagePull {
  image: string
  podUid: Uid
  totalMB: number
  doneMB: number
  /** model time the pull was filed (serialized queue — waits behind others) */
  queuedAt: number
  /** set when the pull reaches the head of the queue and the crane engages */
  startedAt?: number
  /** layer arithmetic: cached base layers shrink the transfer (FIDELITY.md) */
  layersTotal: number
  layersHit: number
}

/**
 * The kubelet's LOCAL view of one pod — probe timers, backoff, termination
 * progress. Distinct from the published status in etcd, which is honest to
 * real kubelet architecture: the foreman knows things City Hall has not been
 * told yet.
 */
export interface LocalPodRuntime {
  podUid: Uid
  nextProbeAt: number
  readinessSuccesses: number
  readinessFails: number
  livenessFails: number
  /** model time the container last started, for the clean-run backoff reset */
  runningSince?: number
  /** container-create completes at this time */
  creatingUntil?: number
  /** chaosCrashLoop: the app will exit at this time */
  crashAt?: number
  /** termination: preStop sleep ends */
  preStopUntil?: number
  /** termination: SIGTERM delivered at */
  sigtermAt?: number
  /** kernel-visible working set while running (leak growth lives here) */
  memMi?: number
  /** failed-pull ladder rung, model seconds (10 → 20 → … → 300) */
  pullBackoffSec?: number
  /** next pull retry at */
  pullBackoffUntil?: number
  /** termination: SIGKILL fires at (sigterm + grace) */
  killAt?: number
  /** synthesized CPU draw from served requests, EMA-decayed (model millicores) */
  cpuUsedM?: number
}

export interface DrainState {
  node: string
  phase: 'evicting' | 'done'
  /** eviction attempts bounced off a budget so far */
  denied: number
  nextAttemptAt: number
  backoffSec: number
}

export interface NodeSim {
  id: string
  objUid: Uid
  powered: boolean
  allocatable: { cpuM: number; memMi: number }
  /** sum of requests of pods bound here (derived each tick) */
  allocated: { cpuM: number; memMi: number }
  /** synthesized live usage from request traffic (derived each tick) */
  used: { cpuM: number }
  leaseRenewAt: number
  imageCache: Set<string>
  /** serialized: index 0 is the active pull */
  pulls: ImagePull[]
  kubelet: {
    sentRev: number
    syncQueue: Uid[]
    nextSweepAt: number
    runtime: Map<Uid, LocalPodRuntime>
  }
  /**
   * The district's kube-proxy: its OWN copy of the directory, programmed via
   * its OWN watch registration — so its signage lags the central board by its
   * courier's pace. Stale-routing windows are real (the delete-race lesson).
   */
  proxy: {
    /** resourceVersion of the slice this district last programmed */
    programmedRev: number
    endpoints: EndpointEntry[]
  }
}

/* ---------------------------------------------------------------------------
 * Harbor, traffic, events, vitals.
 * -------------------------------------------------------------------------*/

export interface RegistryState {
  /** M1 stub: the harbor exists as a data point; M2 builds the waterfront */
  reachable: boolean
  mbps: number
}

export interface TrafficState {
  reqPerSec: number
  /**
   * Deterministic arrivals: reqPerSec × dt accumulates here and dispatches on
   * whole requests — a seeded interleave, deliberately NOT Poisson-random
   * (determinism outranks statistical realism; FIDELITY.md).
   */
  accumulator: number
  /** round-robin cursor over the directory's ready doors */
  rrCursor: number
  /** requests that reached an open door (lifetime) */
  served: number
  /** requests that reached a door no longer serving — the delete-race cost */
  misrouted: number
  /** arrivals the junction refused because the board listed no open doors */
  refused: number
  /** arrivals while no Service existed: nothing to dial */
  idleNoService: number
}

export interface ClusterEvent {
  at: number
  kind: 'Normal' | 'Warning'
  reason: string
  obj: string
  message: string
}

export interface Vitals {
  podsTotal: number
  podsRunning: number
  podsReady: number
  podsPending: number
  nodesReady: number
  etcdRevision: number
  /** worst subscriber lag in revisions */
  watchMaxLagRev: number
  imagePullsActive: number
  restartsTotal: number
  /* -- M6 traffic -- */
  /** doors the directory currently lists as ready */
  readyEndpoints: number
  /** directory board generation (slice generation; 0 = no Service yet) */
  sliceGeneration: number
  reqServedTotal: number
  reqMisroutedTotal: number
  reqRefusedTotal: number
  /** synthesized cluster CPU usage from live traffic, millicores */
  cpuUsedM: number
  /* -- M7 -- */
  /** a CustomResourceDefinition is registered (City Hall's counter window) */
  crdRegistered: boolean
  /* -- M8 -- */
  /** NoExecute countdowns currently armed */
  evictionsArmed: number
  /** eviction attempts bounced off a PodDisruptionBudget, lifetime */
  drainDeniedTotal: number
  /** pod creates rejected by the neighborhood quota, lifetime */
  quotaRejectedTotal: number
  /** the autoscaler desk's last written desired replicas (0 = never) */
  hpaLastDesired: number
}

/* ---------------------------------------------------------------------------
 * Trace — fleshed out at M3; the shape exists so state can carry one.
 * -------------------------------------------------------------------------*/

export type TraceStop =
  | 'client'
  | 'admission'
  | 'etcd_commit'
  | 'watch_fanout'
  | 'deploy_reconcile'
  | 'rs_reconcile'
  | 'sched_queue'
  | 'filter_score'
  | 'bind'
  | 'kubelet_sees'
  | 'image_pull'
  | 'start_probes'
  | 'endpoints'
  /* -- delete rail (M6): ordering is the content -- */
  | 'endpoint_withdraw'
  | 'sigterm'
  | 'grace_countdown'
  | 'sigkill'
  | 'rs_notices'
  /* -- CRD rails (M7): a law with no inspector is paper -- */
  | 'operator'
  | 'beacon'
  | 'done'

export type TracePlayback = 'step' | 'slow' | 'live'

/** One scheduler verdict row, captured for the map-table stop. */
export interface TraceFilterRow {
  node: string
  ok: boolean
  failed?: string
}
export interface TraceScoreRow {
  node: string
  leastAllocated: number
  imageLocality: number
  spread: number
}

/**
 * The flagship trace. Everything here is derived from SimState each tick by
 * src/sim/trace.ts — captured counters persist after their transient sources
 * (an admission receipt, a scheduler cycle) have moved on. Plain JSON so a
 * snapshot carries a mid-flight trace faithfully.
 */
export interface TraceRecord {
  action: ActionKind
  playback: TracePlayback
  stop: TraceStop
  /** bitmask of visited stops (core/model-helpers.traceStopBit) */
  visited: number
  startedAt: number
  /** model time the CURRENT stop was entered */
  stopAt: number
  /** API round trips committed for the traced family — the counter that IS the lesson */
  trips: number
  /** etcd revision at the most recent traced commit */
  rev: number
  /** revision of the subject's own create commit */
  commitRev: number
  /** etcd log revision the derivation has consumed up to */
  scannedRev: number
  /** every uid in the traced family (subject, RS, pods) — trips count these */
  familyUids: Uid[]
  /** primary subject name (pod name, or deployment name for the variant) */
  subject: string
  subjectUid?: Uid
  deploymentUid?: Uid
  replicaSetUid?: Uid
  /** the pod the camera follows (the subject pod, or the family's first) */
  podUid?: Uid
  podName?: string
  /** the admission receipt — every default the manifest did not write */
  mutations: string[]
  /** fan-out */
  watchersNotified: number
  watchersTotal: number
  maxBacklog: number
  /** zoning */
  queuePos: number
  pendingPods: number
  filter?: TraceFilterRow[]
  score?: TraceScoreRow[]
  chosen?: string
  /** foreman */
  kubeletGapRev: number
  syncQueueDepth: number
  /** harbor */
  pullDoneMB: number
  pullTotalMB: number
  pullWaitSec: number
  layersHit: number
  layersTotal: number
  pullSkipped: boolean
  /** a pull record for the traced pod has been observed at least once */
  pullSeen: boolean
  /** probes */
  restarts: number
  readyOks: number
  nextProbeInSec: number
  /** directory */
  serviceListed: boolean
  /** deployment variant */
  desiredReplicas: number
  familyPods: number
  siblingsAtStop: number
  rsCreated: boolean
  /** events emitted since the trace started */
  eventsSince: number
  /** step mode: sim auto-paused at a fresh stop, waiting for traceNext() */
  autoPaused: boolean
  /** knobs snapshot restored by endTrace() */
  savedKnobs: Knobs

  /* -- delete rail (M6) -- */
  /** revision of the commit that stamped deletionTimestamp */
  deleteRev: number
  /** model time deletionTimestamp was committed */
  deletedAt: number
  /** the directory withdrew the door (slice write observed) at this revision */
  withdrawRev: number
  /** model time the withdrawal committed — race evidence against sigtermAt */
  withdrawAt: number
  /** districts whose signage has programmed a view ≥ withdrawRev */
  districtsProgrammed: number
  districtsTotal: number
  /** model time SIGTERM landed at the door (after any preStop sleep) */
  sigtermLandedAt: number
  /** the foreman's SIGKILL backstop time, observed while the runtime lives */
  killAtObserved: number
  /** grace seconds remaining before the SIGKILL backstop, live */
  graceRemainingSec: number
  /** the app exited before the backstop — SIGKILL renders "not needed" */
  cleanExit: boolean
  /** the pod's final 'remove' committed */
  removed: boolean
  /** the replacement the ReplicaSet desk filed (name once observed) */
  replacementName: string
  /** live traffic existed when the rail armed (else the honest no-traffic variant) */
  trafficLive: boolean
  /** requests misrouted since the rail armed */
  misroutedSince: number
  /** traffic.misrouted at arm time */
  misroutedAtStart: number
  /** preStopSleepSec that would outlast the observed propagation, for "try the fix" */
  suggestedPreStopSec: number

  /* -- CRD rails (M7) -- */
  /** admission refused the CR — the real error string, verbatim on the card */
  rejectedError: string
  /** the validating stage found a registered CRD for this kind */
  crdMatched: boolean
  /** operatorRunning at the moment the rail reads it (live) */
  operatorStaffed: boolean
  /** the operator desk's reconcile count since the rail armed */
  operatorReconciles: number
  /** desk counter at arm time (the delta's baseline) */
  operatorReconcilesAtStart: number
  /** street truth from SimState.beacon, mirrored for the card */
  beaconBuilt: boolean
  beaconLit: boolean
  beaconFuelPct: number
}

/* ---------------------------------------------------------------------------
 * Commands — the ONLY way anything mutates the cluster. kubectl is a client.
 * -------------------------------------------------------------------------*/

export type ActionKind =
  | 'apply-pod'
  | 'apply-deployment'
  | 'scale-6'
  | 'set-image-v2'
  | 'delete-pod'
  | 'apply-service'
  | 'apply-crd'
  | 'apply-lighthouse'
  | 'drain-node'
  | 'kill-node'

export interface ApplyPodCommand {
  kind: 'ApplyPod'
  name: string
  image: string
  requests?: { cpuM: number; memMi: number }
  limitMemMi?: number
}

export interface ApplyDeploymentCommand {
  kind: 'ApplyDeployment'
  name: string
  image: string
  replicas: number
  requests?: { cpuM: number; memMi: number }
  limitMemMi?: number
}

export interface ScaleCommand {
  kind: 'Scale'
  deployment: string
  replicas: number
}

export interface SetImageCommand {
  kind: 'SetImage'
  deployment: string
  image: string
}

/** `kubectl rollout undo` — restore the template from the previous contract. */
export interface RollbackImageCommand {
  kind: 'RollbackImage'
  deployment: string
}

/** Raise the template memory limit — a template change, therefore a rollout. */
export interface SetLimitCommand {
  kind: 'SetLimit'
  deployment: string
  limitMemMi: number
}

export interface DeletePodCommand {
  kind: 'DeletePod'
  /** pod name; the newest match wins if a prefix is given */
  name: string
}

export interface ApplyServiceCommand {
  kind: 'ApplyService'
  name: string
  port: number
  /** ingress hostname routed to this service */
  host: string
  /** label selector; defaults to the demo app selector */
  selector?: Record<string, string>
}

/** `kubectl apply -f lighthouse-crd.yaml` — City Hall opens a counter window. */
export interface ApplyCrdCommand {
  kind: 'ApplyCrd'
}

/** `kubectl apply -f lighthouse.yaml` — rejected until the CRD exists. */
export interface ApplyLighthouseCommand {
  kind: 'ApplyLighthouse'
  name: string
  beamRpm: number
}

/** Staff or unstaff the operator's shack. Not a knob: an operator is a process. */
export interface SetOperatorCommand {
  kind: 'SetOperator'
  running: boolean
}

/** No kubectl verb does this — displayed honestly as `chaos: cut power`. */
export interface SetNodePowerCommand {
  kind: 'SetNodePower'
  node: ChaosNodeTarget
  powered: boolean
}

export interface DrainNodeCommand {
  kind: 'DrainNode'
  node: string
}

export interface UncordonNodeCommand {
  kind: 'UncordonNode'
  node: string
}

/** kubectl delete --force --grace-period=0: remove the row without the foreman. */
export interface ForceDeletePodCommand {
  kind: 'ForceDeletePod'
  name: string
}

export type Command =
  | ApplyPodCommand
  | ApplyDeploymentCommand
  | ScaleCommand
  | SetImageCommand
  | RollbackImageCommand
  | SetLimitCommand
  | DeletePodCommand
  | ApplyServiceCommand
  | ApplyCrdCommand
  | ApplyLighthouseCommand
  | SetOperatorCommand
  | SetNodePowerCommand
  | DrainNodeCommand
  | UncordonNodeCommand
  | ForceDeletePodCommand

/* ---------------------------------------------------------------------------
 * Knobs — every one has a visible city effect (KNOB-AUDIT discipline).
 * -------------------------------------------------------------------------*/

export type ChaosNodeTarget = 'none' | 'node-a' | 'node-b' | 'node-c'

export interface Knobs {
  /* time */
  timeScale: number
  paused: boolean
  /* traffic (wired M6) */
  reqPerSec: number
  reqCpuCostM: number
  /* rollout (wired M4) */
  maxSurgePct: number
  maxUnavailablePct: number
  /* probes */
  readinessPeriodSec: number
  livenessPeriodSec: number
  failureThreshold: number
  initialDelaySec: number
  /* lifecycle */
  tgpsSec: number
  preStopSleepSec: number
  /* hpa (wired M8) */
  hpaEnabled: boolean
  hpaTargetCpuPct: number
  hpaMin: number
  hpaMax: number
  /* capacity */
  nodeCount: number
  podCpuRequestM: number
  podMemRequestMi: number
  podMemLimitMi: number
  /* images */
  imageSizeMB: number
  registryMBps: number
  /* cluster */
  unreachableTolerationSec: number
  nodeGraceSec: number
  etcdFsyncMs: number
  watchLatencyMs: number
  /* pdb (wired M8) */
  pdbEnabled: boolean
  pdbMinAvailable: number
  /* chaos (mechanisms land with their milestones) */
  chaosCrashLoop: boolean
  chaosOomLeak: boolean
  chaosReadinessFlake: boolean
  chaosNodeFail: ChaosNodeTarget
  chaosRegistryOutage: boolean
  chaosEtcdSlow: boolean
  chaosLeaderFlap: boolean
  chaosQuotaLow: boolean
}

export const DEFAULT_KNOBS: Knobs = {
  timeScale: 1,
  paused: false,
  reqPerSec: 40,
  reqCpuCostM: 15,
  maxSurgePct: CLAIM_VALUES.rollingUpdate.surgePct,
  maxUnavailablePct: CLAIM_VALUES.rollingUpdate.unavailablePct,
  readinessPeriodSec: CLAIM_VALUES.probes.periodSeconds,
  livenessPeriodSec: CLAIM_VALUES.probes.periodSeconds,
  failureThreshold: CLAIM_VALUES.probes.failureThreshold,
  initialDelaySec: CLAIM_VALUES.probes.initialDelaySeconds,
  tgpsSec: CLAIM_VALUES.termination.defaultGraceSeconds,
  preStopSleepSec: 0,
  hpaEnabled: false,
  hpaTargetCpuPct: 50,
  hpaMin: 1,
  hpaMax: 10,
  nodeCount: 3,
  podCpuRequestM: 250,
  podMemRequestMi: 256,
  podMemLimitMi: 512,
  imageSizeMB: 180,
  registryMBps: 60,
  unreachableTolerationSec: CLAIM_VALUES.tolerations.defaultSeconds,
  nodeGraceSec: CLAIM_VALUES.nodeMonitor.graceSeconds,
  etcdFsyncMs: CLAIM_VALUES.modelEtcd.fsyncMs,
  watchLatencyMs: CLAIM_VALUES.modelWatch.latencyMs,
  pdbEnabled: false,
  pdbMinAvailable: 2,
  chaosCrashLoop: false,
  chaosOomLeak: false,
  chaosReadinessFlake: false,
  chaosNodeFail: 'none',
  chaosRegistryOutage: false,
  chaosEtcdSlow: false,
  chaosLeaderFlap: false,
  chaosQuotaLow: false,
}

/* ---------------------------------------------------------------------------
 * SimState — one mutable object, owned by src/sim, read-only to all else.
 * -------------------------------------------------------------------------*/

export interface SimState {
  /** completed fixed steps */
  tick: number
  /** model seconds (tick × step) */
  now: number
  /** wall seconds since boot (presentation only; never drives the model) */
  realT: number
  /** xorshift32 state — ALL sim randomness flows through this */
  rngState: number
  /** monotonically increasing uid source */
  uidSeq: number
  knobs: Knobs
  scenario: string | null
  scenarioRun: ScenarioRunState | null
  etcd: EtcdState
  api: ApiServerState
  sched: SchedulerState
  controllers: Record<ControllerId, ControllerState>
  nodes: NodeSim[]
  harbor: RegistryState
  traffic: TrafficState
  operatorRunning: boolean
  /**
   * The physical beacon — street truth, like a container's working set. The
   * vault's LighthouseObj.status is written only by the operator; when the
   * shack is dark the two drift apart, and the drift is the lesson.
   */
  beacon: BeaconState | null
  /**
   * Write-time pod→owner index so a DELETED watch record (which carries no
   * object) can still be routed to the owning desk. Sim-internal bookkeeping.
   */
  podOwners: Map<Uid, Uid>
  /**
   * Drains in progress (M8). kubectl drain is a CLIENT loop: cordon once, then
   * evict pod-by-pod, retrying 429s with backoff — inspectors do not sulk.
   */
  drains: DrainState[]
  /**
   * NoExecute countdowns armed by the taint manager (M8): pod uid → the model
   * second the countdown was ARMED. Expiry is computed against the live
   * unreachableTolerationSec dial, so shortening the toleration acts on
   * clocks already running. World renders remaining time as the countdown
   * ring; recovery cancels the entry.
   */
  evictions: Map<Uid, number>
  /** RS keys to re-enqueue after a quota rejection (retry with backoff). */
  quotaRetries: { rsUid: Uid; at: number }[]
  /** lifetime counters surfaced through vitals (M8) */
  counters: { drainDenied: number; quotaRejected: number; hpaLastDesired: number }
  /** ring buffer, cap 500 — the newspaper */
  events: ClusterEvent[]
  trace: TraceRecord | null
  /**
   * Transient per-tick outbox of packet emissions; the facade flushes it to
   * the bus 'flow' event and clears it at the end of every tick. Always empty
   * at snapshot boundaries.
   */
  flowOutbox: FlowEmit[]
  vitals: Vitals
}

/** The lighthouse as it physically stands on the breakwater (plain JSON). */
export interface BeaconState {
  /** uid of the Lighthouse row this structure serves */
  uid: Uid
  /** construction completes at this model time; built when passed */
  buildingUntil: number
  built: boolean
  lit: boolean
  /** street-truth fuel; drains every model second while lit */
  fuelPct: number
  beamRpm: number
  /** a refuel run is on the road; fuel restores on ARRIVAL */
  refuelArriveAt?: number
}

/** A sim-side request for packets on a named road (flushed to bus 'flow'). */
export interface FlowEmit {
  route: string
  kind: FlowKind
  count?: number
  /** override particle colour (e.g. the red misroute flick) */
  color?: number
}

export interface SimApi {
  state: SimState
  /** advance by dt model seconds (already scaled); called by the timebase */
  update(dt: number): void
  /** the single command surface — kubectl is just another client */
  apply(command: Command): void
  setKnob<K extends keyof Knobs>(key: K, value: Knobs[K], source?: 'user'): void
  /**
   * Arm the flagship trace: snapshots knobs, applies the playback posture,
   * enqueues the traced command. One trace at a time; arming replaces.
   */
  startTrace(action: ActionKind, playback: TracePlayback): void
  /** Step mode: resume from an auto-pause and run to the next stop. */
  traceNext(): void
  /** Switch playback posture mid-trace (step ⇄ slow ⇄ live). */
  setTracePlayback(playback: TracePlayback): void
  /** Close the trace and hand every knob back exactly as it was found. */
  endTrace(): void
  /** deterministic, JSON-stable snapshot for tests and save/restore */
  startScenario(id: string): void
  endScenario(): void
  scenarioChoice(choiceId: string): void
  toSnapshot(): unknown
  reset(seed?: number): void
}

/* ===========================================================================
 * ENGINE / UI CONTRACT — carried forward from upstream.
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * Event bus.
 * -------------------------------------------------------------------------*/

/** The Kubernetes packet vocabulary — every moving thing in the city. */
export type FlowKind =
  | 'apply'        // a client's manifest travelling to the permit desk
  | 'commit'       // a stamped write going down into the vault
  | 'watchCourier' // one commit, N couriers, N distinct roads
  | 'workOrder'    // a desk's corrective write, back through the permit hall
  | 'bindWrite'    // zoning's placement decision — also just a write
  | 'imagePull'    // cargo: harbor crane → district gate
  | 'heartbeat'    // foreman lease renewal / status paperwork
  | 'evict'        // eviction paperwork (M8)
  | 'request'      // citizen traffic (M6)
  | 'refuel'       // the lighthouse run (M7)

/** A request to send N particles down a named route. */
export interface FlowRequest {
  route: string
  count?: number
  /** hex colour; defaults to the route's colour */
  color?: number
  /** world units/sec; defaults to the route's speed */
  speed?: number
  size?: number
  kind?: FlowKind
  /** lateral jitter in world units */
  spread?: number
  /** stagger emission over this many seconds */
  stagger?: number
}

export interface BusEvents {
  flow: FlowRequest
  /** camera should frame a component */
  focus: { id: string | null; instant?: boolean }
  /** inspector panel target changed; `part` names a directly-picked substructure */
  select: { id: string | null; part?: 'page'; outlineOnly?: boolean; source?: 'building' }
  hover: { id: string | null }
  knob: { key: keyof Knobs; value: unknown; source?: 'user' }
  scenario: { id: string | null }
  toast: {
    text: string
    kind?: 'info' | 'warn' | 'good'
    ms?: number
    action?: { label: string; quality: QualityLevel }
  }
  narrate: { title: string; body: string; seconds?: number } | null
  'tour:start': { chapter?: number; source?: 'button' | 'keyboard' }
  'tour:stop': Record<string, never>
  'tour:chapter': { index: number; total: number; title: string }
  'scenario:open': { source?: 'button' | 'keyboard' }
  'trace:open': { source?: 'button' | 'keyboard' }
  'trace:run': { statement: ActionKind; playback: TracePlayback }
  /** any canned action executed from the picker (traced or not) */
  'action:run': { kind: ActionKind }
  'panel:open': { panel: 'console' | 'inspector' | 'help'; item?: string }
  /** open one of the physical anatomy instruments, optionally for a component */
  'anatomy:open': { view: 'page' | 'directory'; id?: string }
  'camera:mode': { mode: CameraMode }
  /** named framing preset currently controlling the composition */
  'camera:preset': { preset: 'plan' | null }
  /** first meaningful map gesture in the current pointer interaction */
  'camera:gesture': { kind: 'pan' | 'rotate'; pointer: 'mouse' | 'touch' }
  'quality': { level: QualityLevel }
  'sim:reset': Record<string, never>
  'audio:toggle': Record<string, never>
  'ui:camera-preset': { preset: 'plan' }
  'ui:console': { open?: boolean; key?: string }
  'ui:escape': { handled: boolean }
  'ui:help': { open?: boolean; section?: 'controls' | 'legend' | 'reading' | 'legal' }
  'ui:labels-toggle': Record<string, never>
  'ui:palette': { open?: boolean }
  'ui:theme-toggle': Record<string, never>
}

export type BusHandler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

export interface Bus {
  on<K extends keyof BusEvents>(type: K, fn: BusHandler<K>): () => void
  once<K extends keyof BusEvents>(type: K, fn: BusHandler<K>): () => void
  off<K extends keyof BusEvents>(type: K, fn: BusHandler<K>): void
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void
}

/* ---------------------------------------------------------------------------
 * World modules & the component registry.
 * -------------------------------------------------------------------------*/

/** The Kubetropolis districts. `world` is the whole-island scope used by
 * cross-district components (roads, ground, the overview balloon). */
export type DistrictId =
  | 'gate'
  | 'civic'
  | 'records'
  | 'zoning'
  | 'inspectors'
  | 'node-a'
  | 'node-b'
  | 'node-c'
  | 'reserve'
  | 'harbor'
  | 'ingress'
  | 'world'

export type ComponentKind =
  | 'process'   // an OS process
  | 'memory'    // shared/local memory structure
  | 'storage'   // on-disk
  | 'network'
  | 'client'
  | 'concept'   // an idea, not a thing (reconciliation, the watch stream…)

export interface FocusSpec {
  /** world-space point the camera should look at */
  target: [number, number, number]
  /** preferred distance from target */
  distance: number
  /** preferred direction FROM target TO camera (does not need to be normalised) */
  dir?: [number, number, number]
}

export interface ComponentDef {
  id: string
  name: string
  /** one-line subtitle, e.g. "control-plane process" */
  role: string
  kind: ComponentKind
  district: DistrictId
  /** Pickable root. Raycasting uses its descendants. */
  object: THREE.Object3D
  focus: FocusSpec
  /** world position for the floating label; defaults to focus.target */
  labelAt?: [number, number, number]
  /**
   * 0 = district-scale, always visible
   * 1 = major landmark, visible from medium range
   * 2 = detail, only visible up close
   */
  tier: 0 | 1 | 2
  /** live one-line metric for the label + panel header, evaluated each frame */
  readout?: (s: SimState) => string
  /** override outline colour */
  color?: number
}

export interface QualitySettings {
  level: QualityLevel
  pixelRatio: number
  bloom: boolean
  shadows: boolean
  /** max simultaneous flow particles */
  maxParticles: number
  /** max CSS2D labels visible at once */
  maxLabels: number
  antialias: boolean
}

export type QualityLevel = 'low' | 'reduced' | 'medium' | 'high' | 'ultra'

export interface WorldContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  bus: Bus
  sim: SimState
  quality: QualitySettings
  /** register a pickable/labelled component */
  register(def: ComponentDef): void
  /** shorthand for bus.emit('flow', …) */
  flow(req: FlowRequest): void
  /** shared material/geometry cache — see core/theme.ts */
  theme: ThemeApi
}

export interface WorldModule {
  id: string
  group: THREE.Object3D
  /**
   * @param dt   frame delta in real seconds
   * @param sim  live simulation state
   * @param t    simulated time in seconds
   */
  update(dt: number, sim: SimState, t: number): void
  /** distance-based detail switch, called when the bucket changes */
  setDetail?(level: 0 | 1 | 2): void
  dispose?(): void
}

export type WorldFactory = (ctx: WorldContext) => WorldModule

/* ---------------------------------------------------------------------------
 * Theme API (implemented in core/theme.ts).
 * -------------------------------------------------------------------------*/

export interface ThemeApi {
  color: Record<ColorKey, number>
  /** cached MeshStandardMaterial */
  mat(key: string, opts?: MatOpts): THREE.MeshStandardMaterial
  /** cached emissive/neon material (unlit, bloom-friendly) */
  neon(color: number, intensity?: number, opts?: NeonOpts): THREE.MeshBasicMaterial
  /** cached line material for blueprint edges */
  line(color: number, opacity?: number): THREE.LineBasicMaterial
  /** wireframe edge overlay for a mesh geometry */
  edges(geo: THREE.BufferGeometry, color: number, opacity?: number): THREE.LineSegments
  /** canvas-backed text texture (for decals on floors/walls) */
  textTexture(text: string, opts?: TextTexOpts): THREE.Texture
  /** shared box/cyl geometry cache */
  box(w: number, h: number, d: number): THREE.BufferGeometry
  cyl(rt: number, rb: number, h: number, seg?: number): THREE.CylinderGeometry
  dispose(): void
}

export interface MatOpts {
  color?: number
  roughness?: number
  metalness?: number
  emissive?: number
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  flatShading?: boolean
  side?: THREE.Side
  polygonOffset?: boolean
  polygonOffsetFactor?: number
  polygonOffsetUnits?: number
  /**
   * Whether the shared masonry term is compiled into this material. Default
   * true — structure is masonry. Turn it off for glazing, for rubber, for
   * polished metal: coursed joints on a window claim the wrong material.
   */
  surface?: boolean
}

export interface NeonOpts {
  transparent?: boolean
  opacity?: number
  polygonOffset?: boolean
  polygonOffsetFactor?: number
  polygonOffsetUnits?: number
}

export interface TextTexOpts {
  size?: number
  color?: string
  bg?: string
  font?: string
  padding?: number
  align?: CanvasTextAlign
  letterSpacing?: string
}

/** TV: palette vocabulary is re-cut at the M2 retint. */
export type ColorKey =
  | 'bg'
  | 'fog'
  | 'grid'
  | 'gridBright'
  | 'ground'
  | 'client'
  | 'backend'
  | 'shmem'
  | 'bufClean'
  | 'bufDirty'
  | 'bufPinned'
  | 'bufFree'
  | 'wal'
  | 'walDim'
  | 'storage'
  | 'vacuum'
  | 'checkpoint'
  | 'bgwriter'
  | 'replication'
  | 'lock'
  | 'ok'
  | 'warn'
  | 'crit'
  | 'ink'
  | 'inkDim'
  | 'postmaster'
  | 'archive'
  | 'toast'
  | 'index'
  /* --- Kubetropolis additions (M2). Hues borrowed from the proven palette
   * language above; the Postgres keys stay until the TV engine files that
   * read them are retired. --- */
  | 'civic'
  | 'etcd'
  | 'watch'
  | 'sched'
  | 'kubelet'
  | 'harbor'
  | 'podReady'
  | 'podPending'
  | 'podBackoff'
  | 'podTerminating'
  | 'crd'

/* ---------------------------------------------------------------------------
 * Camera.
 * -------------------------------------------------------------------------*/

export type CameraMode = 'orbit' | 'fly' | 'focus' | 'tour' | 'walk'

export interface CameraApi {
  camera: THREE.PerspectiveCamera
  mode: CameraMode
  setMode(m: CameraMode): void
  /** smoothly frame a focus spec; returns when the move starts */
  focusOn(spec: FocusSpec, opts?: { instant?: boolean; duration?: number }): void
  /** fly along a path for the guided tour */
  flyPath(points: [number, number, number][], lookAt: [number, number, number][], duration: number): Promise<void>
  /** cancel any scripted movement, hand control back to the user */
  release(): void
  update(dt: number): void
  /** distance from the city centre, used for LOD */
  readonly altitude: number
  /** true while a scripted move is running */
  readonly scripted: boolean
  resize(w: number, h: number): void
  dispose(): void
}

/* ---------------------------------------------------------------------------
 * Routes — the road network. Defined in world/layout.ts, drawn by engine/flows.ts.
 * -------------------------------------------------------------------------*/

export interface RouteDef {
  id: string
  /** control points, world space */
  points: [number, number, number][]
  /** default particle colour */
  color: number
  /** default world units/sec */
  speed: number
  /** default particle size */
  size?: number
  /** draw a faint static "road" line for this route */
  visible?: boolean
  /** road line opacity */
  roadOpacity?: number
  /** curve tension for CatmullRom */
  tension?: number
  /** treat control points as a polyline instead of a smooth curve */
  linear?: boolean
}

/* ---------------------------------------------------------------------------
 * Inspector content (arrives with the HUD at M2).
 * -------------------------------------------------------------------------*/

export interface ContentSection {
  heading: string
  /** supports a tiny subset of markdown: **bold**, `code`, [link](url) */
  body: string
}

/**
 * One external pointer for the inspector's "Go deeper" block.
 *
 * `url` is OPTIONAL on purpose: some references are books with no canonical
 * public page, and a guessed link is a fabricated citation. If there is no URL,
 * there is no link — the panel renders those as plain text.
 */
export interface DocRef {
  /** human label, e.g. "Pod Lifecycle" */
  label: string
  /** absolute https URL. Omit when no stable public page exists. */
  url?: string
  /** for source refs: the function(s) worth looking for in that file */
  symbol?: string
  /**
   * false when the link works but the section/chapter number has not been
   * re-checked against the current release. Rendered with a "†" marker, never
   * hidden — an unverified citation the reader can see is honest; a silently
   * confident wrong one is not.
   */
  verified?: boolean
}

/** A paper/PDF book citation — deliberately never rendered as a link. */
export interface BookRef {
  edition: string
  part: string
  chapter: string
  /** honest hedge, shown verbatim on hover */
  confidence?: string
}

/** The reading list behind one component. Every field is optional. */
export interface DocReferences {
  /** kubernetes.io/docs — the reviewed manual */
  docs?: DocRef[]
  /** github.com/kubernetes/kubernetes — the source */
  source?: DocRef[]
  /** KEPs — design rationale */
  keps?: DocRef[]
  book?: BookRef
}

export interface ComponentDoc {
  id: string
  title: string
  subtitle: string
  /** one-sentence "what it is" for the hover tooltip */
  tldr: string
  /** the meaty explanation */
  sections: ContentSection[]
  /** live metrics to show, resolved against SimState */
  metrics?: { label: string; get: (s: SimState) => string; hint?: string }[]
  /** related knobs the user can twiddle right there */
  knobs?: (keyof Knobs)[]
  /** explicit operations; unlike knobs these start work rather than set policy (typed at M3) */
  actions?: string[]
  /** ids of related components, rendered as jump links */
  see?: string[]
  /** source pointers for the curious, e.g. pkg/controller/replicaset */
  source?: string[]
  refs?: DocReferences
}

/* ---------------------------------------------------------------------------
 * Tours & scenarios (runners arrive M4/M5; shapes are contract now).
 * -------------------------------------------------------------------------*/

export interface TourChapter {
  id: string
  title: string
  /** narration shown while the camera flies */
  body: string
  /** component to frame (preferred) */
  focus?: string
  /** or an explicit camera move */
  camera?: FocusSpec
  /**
   * MODEL seconds of narration. The sim clock drives the tour, so pausing
   * the city pauses the chapter. ≤ 45 by law (CLAUDE.md: UI restraint).
   */
  duration: number
  /** knob changes applied on entry (every knob is restored when the tour ends) */
  knobs?: Partial<Knobs>
  /** scenario to trigger on entry */
  scenario?: string | null
  /** mid-chapter canned actions fired ON CAMERA — the anti-passivity answer */
  act?: [number, ActionKind][]
  /** mid-chapter camera moves: [atSecond, componentId] */
  look?: [number, string][]
  /** mid-chapter knob beats (the PG at-beat: flip a chaos toggle ON CAMERA) */
  at?: [number, Partial<Knobs>][]
  /** mid-chapter commands (SetOperator etc. — acts that are not ActionKinds) */
  commandAt?: [number, Command][]
  /** stand up the demo Deployment before this chapter needs one */
  ensureDeployment?: boolean
  /** the chapter's closing prompt — the reader performs it, or skips */
  yourTurn?: TourYourTurn
}

/** What satisfies a chapter's "your turn": a UI act the reader performs. */
export type TourArm =
  | 'select'
  | 'picker'
  | 'scenarios'
  | 'rollback'
  | 'flake'
  | 'operator'
  | { action: ActionKind }

export interface TourYourTurn {
  prompt: string
  arm: TourArm
  /** one-line confirmation once performed */
  done?: string
}

export type ScenarioChoiceId = string

export interface ScenarioDef {
  id: string
  name: string
  blurb: string
  icon: string
  /** knob overrides applied while running */
  knobs: Partial<Knobs>
  /** what to look at when it starts */
  focus?: string
  /** scenario seconds at 1×; 0 = runs until cancelled */
  duration: number
  /** guarantee the demo Deployment exists before the story starts */
  ensureDeployment?: boolean
  /** guarantee the demo Service exists too (M6 traffic scenarios) */
  ensureService?: boolean
  /** start with the shack dark — the paper-law scenario's premise (M7) */
  ensureOperatorOff?: boolean
  /** canned actions fired on schedule — the scenario acts ON CAMERA */
  actionAt?: [number, ActionKind][]
  /** scheduled knob changes (the PG at-beat analog): [atSecond, knobs] */
  knobsAt?: [number, Partial<Knobs>][]
  /** scheduled raw commands (when no canned action fits, e.g. scale 12) */
  commandsAt?: [number, Command][]
  /** narration beats: [atSecond, title, body] */
  beats?: [number, string, string][]
  /** A non-modal operator decision shown only after its instrument threshold. */
  decision?: {
    revealAt: number
    choices: ScenarioChoice[]
  }
}

export interface ScenarioChoice {
  id: ScenarioChoiceId
  label: string
  hint: string
  /** declarative consequence — knobs and/or commands, plus the narrated line */
  effect: {
    knobs?: Partial<Knobs>
    command?: Command
    /** live-state commands (e.g. force-delete every pod on the dead district) */
    commandsFor?(state: SimState): Command[]
    consequence: string
  }
}

/** Live progress of the running scenario (snapshot-safe: data only). */
export interface ScenarioRunState {
  id: string
  startedAt: number
  knobsBefore: Knobs
  setupDone: boolean
  actionIdx: number
  knobIdx: number
  commandIdx: number
  beatIdx: number
  beat?: { title: string; body: string; at: number }
  decisionAvailable: boolean
  choiceTaken?: string
  consequence?: string
  endsAt?: number
}

/* ===========================================================================
 * TV legacy (dies with layout.ts at M2)
 * ---------------------------------------------------------------------------
 * The temporarily-verbatim Postgres world files (world/layout.ts via
 * core/catalog.ts, engine/collision.ts, engine/roads.ts) still reference the
 * upstream city constants and table shapes. Values are frozen literals of the
 * upstream CLAIM_VALUES they used to derive from. Nothing new may import from
 * this block.
 * ==========================================================================*/

/** TV: shared-buffer visual sample grid (upstream bufferSample.gridWidth). */
export const BUF_GRID = 32
export const N_BUFFERS = BUF_GRID * BUF_GRID
export type SampleFrames = number & { readonly __sampleFrames: unique symbol }
export const PG_PAGE_BYTES = 8 * 1024
export const SHARED_BUFFERS_MIN_MIB = 128
export const SHARED_BUFFERS_MAX_MIB = 64 * 1024
export const SHARED_BUFFERS_FULL_SAMPLE_MIB = 8 * 1024
export const N_BACKEND_SLOTS = 16
export const N_WAL_SEG_SLOTS = 14
export const N_VAC_WORKERS = 3
export const REPLICA_BUF_GRID = BUF_GRID

export interface IndexDef {
  id: string
  name: string
  /** btree | gin — purely cosmetic in the model, but shapes the 3D structure. */
  kind: 'btree' | 'gin'
  /** Relative visual size. */
  pages: number
}

export interface TableDef {
  id: string
  name: string
  /** Human blurb shown in the inspector. */
  blurb: string
  /** Base heap size in pages (visual + sim scale). */
  pages: number
  /** Rough tuples per page. */
  tuplesPerPage: number
  /** How hot this table is in the workload (relative weight, sums are normalised). */
  weight: number
  /** Fraction of updates that can be HOT (no index churn). */
  hotFriendly: number
  /** Accent colour (hex int) used by storage + flows. */
  color: number
  indexes: IndexDef[]
  /** Does it have a TOAST sidecar? */
  toast?: boolean
}
