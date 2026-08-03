/* Kubetropolis sim — object builders and helpers.
 * Pure TS: no three.js, no wall clock, no unseeded randomness (CLAUDE.md).
 * All object copies are explicit: etcd's materialized objects are canonical
 * and read-only; every writer clones, modifies, and submits through the API.
 */

import { CLAIM_VALUES } from '../core/claims'
import type {
  CustomResourceDefinitionObj,
  DeploymentObj,
  EndpointSliceObj,
  K8sObject,
  LeaseObj,
  LighthouseObj,
  NodeObj,
  PodObj,
  ReplicaSetObj,
  ServiceObj,
  SimState,
  Uid,
} from '../core/types'

/* ---------------------------------------------------------------------------
 * Model constants (sim-internal; reader-visible numbers live in core/claims).
 * -------------------------------------------------------------------------*/

export const NODE_CPU_M = 4000
export const NODE_MEM_MI = 8192
/** container create (post-pull) duration, model seconds */
export const CREATE_SECONDS = 1.5
/** a SIGTERM'd well-behaved app exits this fast, model seconds */
export const TERM_CLEAN_EXIT_SECONDS = 2
/** chaosCrashLoop: the app exits this long after starting, model seconds */
export const CRASH_AFTER_SECONDS = 20
/** chaosOomLeak: v2 working-set growth, model MiB per model second */
export const OOM_LEAK_MI_PER_SEC = 4
/** a pull attempt against an unreachable registry fails after this long */
export const PULL_FAIL_AFTER_SECONDS = 4
/** unschedulable pods retry after this backoff, model seconds */
export const SCHED_BACKOFF_SECONDS = 5
/** max pods a ReplicaSet desk files per reconcile visit */
export const RS_CREATE_BATCH = 3
/** reconcile keys a desk processes per tick */
export const CONTROLLER_BUDGET = 2
export const EVENTS_CAP = 500
export const DEFAULT_NAMESPACE = 'shops'

/* ---------------------------------------------------------------------------
 * Deterministic identity.
 * -------------------------------------------------------------------------*/

export function nextUid(state: SimState): Uid {
  state.uidSeq += 1
  return `u${state.uidSeq.toString(36)}`
}

/** uid ordinal for deterministic "newest first" victim selection */
export function uidSeqOf(uid: Uid): number {
  return parseInt(uid.slice(1), 36)
}

/** Deterministic short suffix for generated pod names. */
export function nameSuffix(state: SimState): string {
  state.uidSeq += 1
  return state.uidSeq.toString(36).padStart(4, '0')
}

/** djb2 over the template identity — keeps sibling ReplicaSets disjoint. */
export function templateHash(template: { image: string; requests: { cpuM: number; memMi: number }; limitMemMi: number }): string {
  const s = `${template.image}|${template.requests.cpuM}|${template.requests.memMi}|${template.limitMemMi}`
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36).slice(0, 6)
}

/* ---------------------------------------------------------------------------
 * Builders. Admission stamps defaults (probes, tolerations, grace, pull
 * policy) — builders leave those zeroed so the stamped receipt is honest.
 * -------------------------------------------------------------------------*/

const ZERO_PROBE = {
  periodSeconds: 0,
  failureThreshold: 0,
  successThreshold: 0,
  initialDelaySeconds: 0,
}

export function mkPod(
  state: SimState,
  name: string,
  spec: { image: string; requests: { cpuM: number; memMi: number }; limitMemMi: number },
  ownerUid?: Uid,
  labels: Record<string, string> = {},
): PodObj {
  return {
    uid: nextUid(state),
    kind: 'Pod',
    name,
    namespace: DEFAULT_NAMESPACE,
    resourceVersion: 0,
    generation: 1,
    labels,
    ownerUid,
    finalizers: [],
    spec: {
      image: spec.image,
      requests: { ...spec.requests },
      limitMemMi: spec.limitMemMi,
      tgps: 0,
      tolerations: [],
      probes: { readiness: { ...ZERO_PROBE }, liveness: { ...ZERO_PROBE } },
      preStopSleepSec: 0,
    },
    status: {
      phase: 'Pending',
      ready: false,
      container: {
        state: 'waiting',
        restartCount: 0,
        backoffSec: 0,
        memMi: 0,
      },
    },
  }
}

export function mkDeployment(
  state: SimState,
  name: string,
  spec: {
    replicas: number
    template: { image: string; requests: { cpuM: number; memMi: number }; limitMemMi: number }
    maxSurgePct: number
    maxUnavailablePct: number
  },
): DeploymentObj {
  return {
    uid: nextUid(state),
    kind: 'Deployment',
    name,
    namespace: DEFAULT_NAMESPACE,
    resourceVersion: 0,
    generation: 1,
    labels: { app: name },
    finalizers: [],
    spec: {
      replicas: spec.replicas,
      template: { ...spec.template, requests: { ...spec.template.requests } },
      maxSurgePct: spec.maxSurgePct,
      maxUnavailablePct: spec.maxUnavailablePct,
    },
    status: { observed: 0, ready: 0, updated: 0, observedGeneration: 0 },
  }
}

export function mkReplicaSet(
  state: SimState,
  dep: DeploymentObj,
  hash: string,
  initialReplicas = dep.spec.replicas,
): ReplicaSetObj {
  return {
    uid: nextUid(state),
    kind: 'ReplicaSet',
    name: `${dep.name}-${hash}`,
    namespace: dep.namespace,
    resourceVersion: 0,
    generation: 1,
    labels: { app: dep.name, 'pod-template-hash': hash },
    ownerUid: dep.uid,
    finalizers: [],
    spec: {
      replicas: initialReplicas,
      podTemplateHash: hash,
      template: { ...dep.spec.template, requests: { ...dep.spec.template.requests } },
    },
    status: { observed: 0, ready: 0 },
  }
}

export function mkNode(state: SimState, name: string): NodeObj {
  return {
    uid: nextUid(state),
    kind: 'Node',
    name,
    namespace: 'cluster',
    resourceVersion: 0,
    generation: 1,
    labels: {},
    finalizers: [],
    spec: { taints: [] },
    status: {
      conditions: [{ type: 'Ready', status: 'True', since: 0 }],
      allocatable: { cpuM: NODE_CPU_M, memMi: NODE_MEM_MI },
    },
  }
}

export function mkLease(state: SimState, nodeName: string): LeaseObj {
  return {
    uid: nextUid(state),
    kind: 'Lease',
    name: nodeName,
    namespace: 'kube-node-lease',
    resourceVersion: 0,
    generation: 1,
    labels: {},
    finalizers: [],
    spec: {
      holder: nodeName,
      durationSeconds: CLAIM_VALUES.kubeletHeartbeat.leaseDurationSeconds,
      renewedAt: 0,
    },
  }
}

/* ---------------------------------------------------------------------------
 * Read helpers (etcd.objects is the source of truth; never mutate results).
 * -------------------------------------------------------------------------*/

export function clone<T extends K8sObject>(obj: T): T {
  return structuredClone(obj)
}

export function getPod(state: SimState, uid: Uid): PodObj | undefined {
  const o = state.etcd.objects.get(uid)
  return o?.kind === 'Pod' ? o : undefined
}

export function getDeployment(state: SimState, uid: Uid): DeploymentObj | undefined {
  const o = state.etcd.objects.get(uid)
  return o?.kind === 'Deployment' ? o : undefined
}

export function getReplicaSet(state: SimState, uid: Uid): ReplicaSetObj | undefined {
  const o = state.etcd.objects.get(uid)
  return o?.kind === 'ReplicaSet' ? o : undefined
}

export function allOfKind<T extends K8sObject>(state: SimState, kind: T['kind']): T[] {
  const out: T[] = []
  for (const o of state.etcd.objects.values()) if (o.kind === kind) out.push(o as T)
  return out
}

export function mkService(
  state: SimState,
  name: string,
  spec: { port: number; host: string; selector?: Record<string, string> },
): ServiceObj {
  return {
    uid: nextUid(state),
    kind: 'Service',
    name,
    namespace: DEFAULT_NAMESPACE,
    resourceVersion: 0,
    generation: 1,
    labels: {},
    finalizers: [],
    spec: {
      selector: spec.selector ?? { app: name },
      port: spec.port,
      ingressHost: spec.host,
    },
    status: {},
  }
}

export function mkEndpointSlice(state: SimState, svc: ServiceObj): EndpointSliceObj {
  return {
    uid: nextUid(state),
    kind: 'EndpointSlice',
    name: `${svc.name}-slice`,
    namespace: svc.namespace,
    resourceVersion: 0,
    generation: 1,
    labels: { 'kubernetes.io/service-name': svc.name },
    ownerUid: svc.uid,
    finalizers: [],
    spec: { serviceUid: svc.uid, endpoints: [] },
    status: {},
  }
}

/** The single demo Service (M6 models one service + one slice). */
export function getService(state: SimState): ServiceObj | undefined {
  for (const o of state.etcd.objects.values()) if (o.kind === 'Service') return o
  return undefined
}

/* ---------------------------------------------------------------------------
 * CRDs and the Lighthouse (M7).
 * -------------------------------------------------------------------------*/

const CRD = CLAIM_VALUES.crd

export function mkCrd(state: SimState): CustomResourceDefinitionObj {
  return {
    uid: nextUid(state),
    kind: 'CustomResourceDefinition',
    name: `${CRD.plural}.${CRD.group}`,
    namespace: 'cluster',
    resourceVersion: 0,
    generation: 1,
    labels: {},
    finalizers: [],
    spec: { group: CRD.group, names: { kind: CRD.kind, plural: CRD.plural } },
    status: { accepted: true },
  }
}

export function mkLighthouse(state: SimState, name: string, beamRpm: number): LighthouseObj {
  return {
    uid: nextUid(state),
    kind: 'Lighthouse',
    name,
    namespace: DEFAULT_NAMESPACE,
    resourceVersion: 0,
    generation: 1,
    labels: {},
    finalizers: [],
    spec: { beamRpm, rangeM: 900 },
    status: { lit: false, fuelPct: 100 },
  }
}

export function getCrd(state: SimState): CustomResourceDefinitionObj | undefined {
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'CustomResourceDefinition') return o
  }
  return undefined
}

export function getLighthouse(state: SimState): LighthouseObj | undefined {
  for (const o of state.etcd.objects.values()) if (o.kind === 'Lighthouse') return o
  return undefined
}

export function getSlice(state: SimState): EndpointSliceObj | undefined {
  for (const o of state.etcd.objects.values()) if (o.kind === 'EndpointSlice') return o
  return undefined
}

export function podsOwnedBy(state: SimState, ownerUid: Uid): PodObj[] {
  const out: PodObj[] = []
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'Pod' && o.ownerUid === ownerUid) out.push(o)
  }
  return out
}

export function pushEvent(
  state: SimState,
  kind: 'Normal' | 'Warning',
  reason: string,
  obj: string,
  message: string,
): void {
  state.events.push({ at: state.now, kind, reason, obj, message })
  if (state.events.length > EVENTS_CAP) state.events.splice(0, state.events.length - EVENTS_CAP)
}

/** xorshift32 — ALL sim randomness flows through state.rngState. */
export function rng01(state: SimState): number {
  let x = state.rngState | 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.rngState = x | 0
  return ((x >>> 0) % 1_000_000) / 1_000_000
}
