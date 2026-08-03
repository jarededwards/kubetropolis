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
  /** bumps on spec change only — scaling a Deployment does NOT bump it */
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

export interface Toleration {
  key: string
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
  status: { observed: number; ready: number; updated: number }
}

export interface NodeCondition {
  type: 'Ready'
  status: boolean
  /** model seconds of the last transition */
  since: number
}

export interface NodeObj extends ObjMeta {
  kind: 'Node'
  spec: { unschedulable?: boolean; taints: { key: string }[] }
  status: {
    conditions: NodeCondition[]
    allocatable: { cpuM: number; memMi: number }
  }
}

export interface LeaseObj extends ObjMeta {
  kind: 'Lease'
  spec: { holder: string; durationSeconds: number; renewedAt: number }
}

/** The kinds the M1 model actually stores. Later milestones extend this. */
export type K8sObject = PodObj | ReplicaSetObj | DeploymentObj | NodeObj | LeaseObj

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
export type ApiVerb = 'create' | 'update' | 'updateStatus' | 'delete' | 'remove'

export type AdmissionStage = 'authn' | 'mutating' | 'validating' | 'toEtcd'

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
  /** set when compaction outran this watcher; it must relist */
  needsRelist: boolean
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
  expect: Map<Uid, { creates: Uid[]; deletes: Uid[] }>
}

/* ---------------------------------------------------------------------------
 * Nodes & kubelets — districts and their foremen.
 * -------------------------------------------------------------------------*/

export interface ImagePull {
  image: string
  podUid: Uid
  totalMB: number
  doneMB: number
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
  /** termination: SIGKILL fires at (sigterm + grace) */
  killAt?: number
}

export interface NodeSim {
  id: string
  objUid: Uid
  powered: boolean
  allocatable: { cpuM: number; memMi: number }
  /** sum of requests of pods bound here (derived each tick) */
  allocated: { cpuM: number; memMi: number }
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
  /** M1 stub: request traffic arrives at M6 */
  reqPerSec: number
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
}

/* ---------------------------------------------------------------------------
 * Trace — fleshed out at M3; the shape exists so state can carry one.
 * -------------------------------------------------------------------------*/

export type TraceStop =
  | 'client'
  | 'admission'
  | 'etcd_commit'
  | 'watch_fanout'
  | 'sched_queue'
  | 'filter_score'
  | 'bind'
  | 'kubelet_sees'
  | 'image_pull'
  | 'start_probes'
  | 'endpoints'
  | 'done'

export type TracePlayback = 'step' | 'slow' | 'live'

export interface TraceRecord {
  action: ActionKind
  stop: TraceStop
  /** bitmask of visited stops (core/model-helpers.traceStopBit) */
  visited: number
  startedAt: number
  /** API round trips so far — the counter that IS the lesson */
  trips: number
  /** etcd revision at the most recent traced commit */
  rev: number
  playback: TracePlayback
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

export interface DeletePodCommand {
  kind: 'DeletePod'
  /** pod name; the newest match wins if a prefix is given */
  name: string
}

export type Command =
  | ApplyPodCommand
  | ApplyDeploymentCommand
  | ScaleCommand
  | DeletePodCommand

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
  maxSurgePct: 25,
  maxUnavailablePct: 25,
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
  etcd: EtcdState
  api: ApiServerState
  sched: SchedulerState
  controllers: Record<ControllerId, ControllerState>
  nodes: NodeSim[]
  harbor: RegistryState
  traffic: TrafficState
  operatorRunning: boolean
  /**
   * Write-time pod→owner index so a DELETED watch record (which carries no
   * object) can still be routed to the owning desk. Sim-internal bookkeeping.
   */
  podOwners: Map<Uid, Uid>
  /** ring buffer, cap 500 — the newspaper */
  events: ClusterEvent[]
  trace: TraceRecord | null
  vitals: Vitals
}

export interface SimApi {
  state: SimState
  /** advance by dt model seconds (already scaled); called by the timebase */
  update(dt: number): void
  /** the single command surface — kubectl is just another client */
  apply(command: Command): void
  setKnob<K extends keyof Knobs>(key: K, value: Knobs[K], source?: 'user'): void
  /** deterministic, JSON-stable snapshot for tests and save/restore */
  toSnapshot(): unknown
  reset(seed?: number): void
}

/* ===========================================================================
 * ENGINE / UI CONTRACT — carried forward from upstream.
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * Event bus.
 * -------------------------------------------------------------------------*/

/** TV: flow vocabulary is re-cut when flows wire up with real routes (M2/M6). */
export type FlowKind =
  | 'query'      // client → backend
  | 'result'     // backend → client
  | 'page_read'  // storage → shared buffers
  | 'page_write' // shared buffers → storage
  | 'wal'        // wal record
  | 'wal_flush'
  | 'archive'
  | 'stream'     // replication
  | 'ack'
  | 'dead'       // dead tuples to the landfill
  | 'fork'       // postmaster spawning
  | 'stat'

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
  'trace:open': { source?: 'button' | 'keyboard' }
  /** M3 tightens statement to ActionKind once the trace UI lands */
  'trace:run': { statement: string; playback: TracePlayback }
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

/** TV: district vocabulary is replaced wholesale with the Kubetropolis
 * geography at M2 (civic, records, zoning, inspectors, node districts,
 * harbor, ingress). The Postgres ids below keep the TV world compiling. */
export type DistrictId =
  | 'clients'
  | 'backends'
  | 'shmem'
  | 'wal'
  | 'storage'
  | 'maintenance'
  | 'replication'
  | 'planner'
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
  /** wall-clock seconds this chapter lasts */
  duration: number
  /** knob changes applied on entry */
  knobs?: Partial<Knobs>
  /** scenario to trigger on entry */
  scenario?: string | null
  /** mid-chapter canned actions fired ON CAMERA — the anti-passivity answer */
  act?: [number, ActionKind][]
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
  /** optional canned action fired on entry */
  action?: { kind: ActionKind }
  /** narration beats: [atSecond, title, body] */
  beats?: [number, string, string][]
  /** A non-modal operator decision shown only after its instrument threshold. */
  decision?: {
    revealAt: number
    choices: {
      id: ScenarioChoiceId
      label: string
      hint: string
    }[]
  }
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
