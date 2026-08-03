/* Derived from PGSimCity src/core/claims.ts @ 6d2c854 (Apache-2.0, © 2026
 * Nikolay Samokhvalov). Rewritten for Kubetropolis at M1: the Postgres claim
 * set and machine-walk spine are gone; this is now the Kubernetes claims
 * registry. The MECHANISM is inherited: values live here, every surface reads
 * them from here, and a structural test keeps the registry honest.
 *
 * Rules (CLAUDE.md "Kubernetes truth rules"):
 *  - Every number or mechanism shown to the reader is a claim with a source.
 *  - The sim imports its constants FROM CLAIM_VALUES — never inlines a copy.
 *  - coverage: 'exact'   — the model implements the real value/mechanism.
 *              'modeled' — a deliberate model stand-in (scaled or simplified);
 *                          the statement says so and modelNote explains.
 *              'absent'  — disclosed non-implementation (also in FIDELITY.md).
 */

import { BUILD_LABEL } from './build'

const K8S_DOCS = 'https://kubernetes.io/docs/'

/* ---------------------------------------------------------------------------
 * Values — the single source for every number the sim or copy uses.
 * -------------------------------------------------------------------------*/

export const CLAIM_VALUES = {
  appVersion: {
    label: BUILD_LABEL,
  },
  /** Presentation vocabulary carried over from the vendored engine. */
  modelDuration: {
    shortUnit: 'model s',
    millisecondUnit: 'model ms',
    prose: 'model time',
  },
  cityComponentRoute: {
    hashPrefix: '#/c/',
  },
  probes: {
    periodSeconds: 10,
    failureThreshold: 3,
    successThreshold: 1,
    timeoutSeconds: 1,
    initialDelaySeconds: 0,
  },
  crashLoop: {
    baseSeconds: 10,
    factor: 2,
    capSeconds: 300,
    resetAfterCleanSeconds: 600,
  },
  termination: {
    defaultGraceSeconds: 30,
  },
  tolerations: {
    /** auto-injected node.kubernetes.io/not-ready + unreachable, seconds */
    defaultSeconds: 300,
  },
  nodeMonitor: {
    periodSeconds: 5,
    graceSeconds: 50,
  },
  kubeletHeartbeat: {
    statusUpdateSeconds: 10,
    leaseDurationSeconds: 40,
    syncFrequencySeconds: 60,
  },
  imagePull: {
    serialized: true,
    backoffCapSeconds: 300,
  },
  restartPolicy: {
    default: 'Always',
  },
  podPhases: ['Pending', 'Running', 'Succeeded', 'Failed', 'Unknown'],
  etcdCompaction: {
    intervalSeconds: 300,
  },
  /** Model-only pacing: deliberately slow so couriers are visible. */
  modelWatch: {
    latencyMs: 300,
  },
  modelEtcd: {
    fsyncMs: 5,
  },
} as const

/* ---------------------------------------------------------------------------
 * The claims themselves.
 * -------------------------------------------------------------------------*/

export type ClaimCoverage = 'exact' | 'modeled' | 'absent'

export interface K8sClaim {
  id: string
  /** One sentence, reader-facing, numbers matching CLAIM_VALUES. */
  statement: string
  /** kubernetes.io (or KEP) URL. Omitted ONLY when coverage is 'modeled' with a modelNote. */
  source?: string
  coverage: ClaimCoverage
  /** Required when no source: why the model owns this number. */
  modelNote?: string
  /** Surfaces that read this claim (grep anchors, not enforced yet). */
  usedBy: string[]
}

export const CLAIMS: readonly K8sClaim[] = [
  {
    id: 'probe.defaults',
    statement:
      `Probes default to periodSeconds ${CLAIM_VALUES.probes.periodSeconds}, `
      + `failureThreshold ${CLAIM_VALUES.probes.failureThreshold}, `
      + `successThreshold ${CLAIM_VALUES.probes.successThreshold}, `
      + `timeoutSeconds ${CLAIM_VALUES.probes.timeoutSeconds}, `
      + `initialDelaySeconds ${CLAIM_VALUES.probes.initialDelaySeconds}.`,
    source: `${K8S_DOCS}tasks/configure-pod-container/configure-liveness-readiness-startup-probes/`,
    coverage: 'exact',
    usedBy: ['sim/apiserver', 'sim/kubelet'],
  },
  {
    id: 'probe.semantics',
    statement:
      'A failed liveness probe kills and restarts the container; a failed readiness probe '
      + 'only marks the Pod unready and removes it from Service traffic.',
    source: `${K8S_DOCS}concepts/workloads/pods/probes/`,
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'crashloop.backoff',
    statement:
      `Container restarts back off starting at ${CLAIM_VALUES.crashLoop.baseSeconds}s, `
      + `doubling to a ${CLAIM_VALUES.crashLoop.capSeconds}s cap, and reset after `
      + `${CLAIM_VALUES.crashLoop.resetAfterCleanSeconds}s of clean running.`,
    source: `${K8S_DOCS}concepts/workloads/pods/pod-lifecycle/`,
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'pod.restartPolicy',
    statement: `Pod restartPolicy defaults to ${CLAIM_VALUES.restartPolicy.default}.`,
    source: `${K8S_DOCS}concepts/workloads/pods/pod-lifecycle/`,
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'pod.phases',
    statement: `Pod phase is one of ${CLAIM_VALUES.podPhases.join(', ')}.`,
    source: `${K8S_DOCS}concepts/workloads/pods/pod-lifecycle/`,
    coverage: 'exact',
    usedBy: ['core/types', 'ui/debug-overlay'],
  },
  {
    id: 'termination.grace',
    statement:
      `terminationGracePeriodSeconds defaults to ${CLAIM_VALUES.termination.defaultGraceSeconds}; `
      + 'the kubelet sends SIGTERM first and SIGKILL when the grace period expires.',
    source: `${K8S_DOCS}concepts/workloads/pods/pod-lifecycle/#pod-termination`,
    coverage: 'exact',
    usedBy: ['sim/apiserver', 'sim/kubelet'],
  },
  {
    id: 'evict.toleration300',
    statement:
      'Pods are created with node.kubernetes.io/not-ready and unreachable tolerations of '
      + `${CLAIM_VALUES.tolerations.defaultSeconds}s, so they stay bound five minutes after a node is lost.`,
    source: `${K8S_DOCS}concepts/scheduling-eviction/taint-and-toleration/#taint-based-evictions`,
    coverage: 'exact',
    usedBy: ['sim/apiserver'],
  },
  {
    id: 'node.monitor',
    statement:
      `The node lifecycle controller checks every ${CLAIM_VALUES.nodeMonitor.periodSeconds}s and marks a node `
      + `NotReady after ${CLAIM_VALUES.nodeMonitor.graceSeconds}s without a heartbeat (current default; historically 40s).`,
    source: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/',
    coverage: 'exact',
    usedBy: ['sim/nodes'],
  },
  {
    id: 'kubelet.heartbeat',
    statement:
      `The kubelet reports status every ${CLAIM_VALUES.kubeletHeartbeat.statusUpdateSeconds}s and renews a Lease with a `
      + `${CLAIM_VALUES.kubeletHeartbeat.leaseDurationSeconds}s duration.`,
    source: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
    coverage: 'exact',
    usedBy: ['sim/nodes'],
  },
  {
    id: 'kubelet.sync',
    statement:
      'The kubelet re-synchronizes running containers with desired state at most every '
      + `${CLAIM_VALUES.kubeletHeartbeat.syncFrequencySeconds}s even without watch events.`,
    source: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'images.pullSerialized',
    statement: 'The kubelet pulls images one at a time per node by default (serializeImagePulls).',
    source: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'images.pullPolicy',
    statement:
      'Omitting imagePullPolicy defaults to Always for :latest or untagged images and IfNotPresent otherwise.',
    source: `${K8S_DOCS}concepts/containers/images/`,
    coverage: 'exact',
    usedBy: ['sim/apiserver'],
  },
  {
    id: 'images.backoffCap',
    statement: `Failed image pulls retry with a backoff that grows to ${CLAIM_VALUES.imagePull.backoffCapSeconds}s.`,
    source: `${K8S_DOCS}concepts/containers/images/`,
    coverage: 'exact',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'etcd.compaction',
    statement:
      `The API server requests etcd compaction every ${CLAIM_VALUES.etcdCompaction.intervalSeconds}s by default; `
      + 'watchers older than the compacted revision must relist.',
    source: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/',
    coverage: 'exact',
    usedBy: ['sim/etcd'],
  },
  {
    id: 'model.watchLatency',
    statement:
      `Watch delivery in this model takes ${CLAIM_VALUES.modelWatch.latencyMs} model ms — deliberately slow `
      + 'so the courier hop from the ledger to each subscriber is visible.',
    coverage: 'modeled',
    modelNote: 'Real watch delivery is single-digit milliseconds; pacing is the lesson here.',
    usedBy: ['sim/apiserver', 'ui/debug-overlay'],
  },
  {
    id: 'model.etcdFsync',
    statement:
      `The vault stamps a write in ${CLAIM_VALUES.modelEtcd.fsyncMs} model ms at rest; chaos knobs stretch it.`,
    coverage: 'modeled',
    modelNote: 'Stands in for etcd fsync latency; the ordering (quorum, then fsync, then visible) is the claim.',
    usedBy: ['sim/etcd'],
  },
] as const

/** Fast lookup; the structural test asserts ids are unique. */
export const CLAIM_BY_ID: ReadonlyMap<string, K8sClaim> = new Map(CLAIMS.map((c) => [c.id, c]))
