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
  /** The Kubernetes minor all defaults in this registry were verified against. */
  k8sVersion: '1.36',
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
  hpa: {
    syncSeconds: 15,
    /** deadband: recommendations within ±10% of 1.0 never move the pen */
    tolerancePct: 10,
    /** downscale stabilization: the desk ignores its own lower numbers this long */
    stabilizationSeconds: 300,
  },
  disruption: {
    /** HTTP status an eviction blocked by a PodDisruptionBudget returns */
    evictionBlockedStatus: 429,
    /** the drain client's retry backoff toward a blocked budget, model seconds */
    modelRetryBaseSeconds: 5,
    modelRetryCapSeconds: 30,
  },
  kubeletHeartbeat: {
    /** Lease renewal — every 10s, a quarter of the 40s lease duration */
    leaseRenewSeconds: 10,
    leaseDurationSeconds: 40,
    /** Node .status heartbeat — only every 5 minutes (nodeStatusReportFrequency) */
    statusReportSeconds: 300,
    syncFrequencySeconds: 60,
  },
  controllerExpectations: {
    /** ExpectationsTimeout in controller_utils.go */
    ttlSeconds: 300,
    /** model resync cadence for desks (real informer resync is ~12h) */
    resyncSeconds: 300,
  },
  imagePull: {
    serialized: true,
    /** failed pulls ladder like crashes: base doubling to the cap */
    backoffBaseSeconds: 10,
    backoffFactor: 2,
    backoffCapSeconds: 300,
  },
  rollingUpdate: {
    /** maxSurge default — rounds UP against desired replicas */
    surgePct: 25,
    /** maxUnavailable default — rounds DOWN against desired replicas */
    unavailablePct: 25,
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
    /** periodic bookmark cadence (real bookmarks are opt-in, ~1/min, unguaranteed) */
    bookmarkSeconds: 60,
  },
  modelEtcd: {
    fsyncMs: 5,
  },
  /**
   * Model-only: the Lighthouse's physics. Fuel drift exists so reconciliation
   * is ongoing BY CONSTRUCTION — a custom resource whose desired state decays
   * unless its operator keeps correcting it.
   */
  modelLighthouse: {
    /** street-truth fuel drain while lit, percent per model second */
    fuelDecayPctPerSec: 0.4,
    /** the operator dispatches a refuel run below this */
    refuelBelowPct: 30,
    /** docks → breakwater travel time; fuel restores on ARRIVAL */
    refuelTravelSeconds: 12,
    /** construction time once the operator files the build */
    buildSeconds: 6,
    /** status published in buckets this size — desks do not spam the vault */
    statusBucketPct: 5,
  },
  crd: {
    group: 'harbor.city',
    kind: 'Lighthouse',
    plural: 'lighthouses',
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
  /** kubernetes.io (or KEP/source) URL. Omitted ONLY when coverage is 'modeled' with a modelNote. */
  source?: string
  coverage: ClaimCoverage
  /** Required when no source, and on every downgraded coverage: what the model actually does. */
  modelNote?: string
  /**
   * CLAIM_VALUES group this claim's numbers live in. REQUIRED for 'exact'
   * claims whose statement contains numbers — the structural test verifies a
   * usedBy source file really reads CLAIM_VALUES.<values> (anti-rot).
   */
  values?: keyof typeof CLAIM_VALUES
  /** Surfaces that read this claim. */
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
    coverage: 'modeled',
    modelNote:
      'Values are stamped and the readiness machinery runs them exactly; probe '
      + 'timeoutSeconds is stated but timeouts are not modeled (FIDELITY.md).',
    values: 'probes',
    usedBy: ['sim/apiserver', 'sim/kubelet'],
  },
  {
    id: 'probe.semantics',
    statement:
      'A failed liveness probe kills and restarts the container; a failed readiness probe '
      + 'only marks the Pod unready and removes it from Service traffic.',
    source: `${K8S_DOCS}concepts/workloads/pods/probes/`,
    coverage: 'modeled',
    modelNote:
      'Both halves are implemented: readiness unlists; liveness (via the '
      + 'chaosLivenessFail dial) kills and restarts on the ladder. Probes have '
      + 'no timeout in the model.',
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
    values: 'crashLoop',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'hpa.sync',
    statement:
      `The HorizontalPodAutoscaler control loop runs every ${CLAIM_VALUES.hpa.syncSeconds}s by default.`,
    source: `${K8S_DOCS}reference/command-line-tools-reference/kube-controller-manager/`,
    coverage: 'exact',
    values: 'hpa',
    usedBy: ['sim/controllers/hpa'],
  },
  {
    id: 'hpa.formula',
    statement:
      'desiredReplicas = ceil(currentReplicas × currentUtilization / targetUtilization), '
      + `with a ${CLAIM_VALUES.hpa.tolerancePct}% tolerance inside which no scaling happens.`,
    source: `${K8S_DOCS}tasks/run-application/horizontal-pod-autoscale/`,
    coverage: 'exact',
    values: 'hpa',
    usedBy: ['sim/controllers/hpa'],
  },
  {
    id: 'hpa.stabilization',
    statement:
      `Scale-down uses a stabilization window (default ${CLAIM_VALUES.hpa.stabilizationSeconds}s): `
      + 'the controller acts on the HIGHEST recommendation inside the window, so brief dips never demolish.',
    source: `${K8S_DOCS}tasks/run-application/horizontal-pod-autoscale/`,
    coverage: 'exact',
    values: 'hpa',
    usedBy: ['sim/controllers/hpa'],
  },
  {
    id: 'drain.pdb429',
    statement:
      'API-initiated eviction respects PodDisruptionBudgets: an eviction that would violate '
      + `the budget is refused with HTTP ${CLAIM_VALUES.disruption.evictionBlockedStatus}, and the drain retries.`,
    source: `${K8S_DOCS}concepts/scheduling-eviction/api-eviction/`,
    coverage: 'exact',
    values: 'disruption',
    usedBy: ['sim/apiserver'],
  },
  {
    id: 'taint.eviction',
    statement:
      'NoExecute taint-based eviction is performed by the node lifecycle controller directly — '
      + 'it is not an API-initiated eviction, so PodDisruptionBudgets do not protect against node loss.',
    source: `${K8S_DOCS}concepts/scheduling-eviction/taint-and-toleration/#taint-based-evictions`,
    coverage: 'modeled',
    modelNote:
      'After the toleration countdown the model removes the pod row in one NodeLost write; real pods '
      + 'linger Terminating until the Node object goes away. FIDELITY.md discloses the shortcut.',
    usedBy: ['sim/lifecycle'],
  },
  {
    id: 'pod.restartPolicy',
    statement: `Pod restartPolicy defaults to ${CLAIM_VALUES.restartPolicy.default}.`,
    source: `${K8S_DOCS}concepts/workloads/pods/pod-lifecycle/`,
    coverage: 'absent',
    modelNote:
      'The restartPolicy field is not modeled; Always semantics are implicit in '
      + 'the restart ladder. Disclosed in FIDELITY.md.',
    usedBy: ['FIDELITY.md'],
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
    values: 'termination',
    usedBy: ['sim/apiserver', 'sim/kubelet', 'core/types'],
  },
  {
    id: 'evict.toleration300',
    statement:
      'Pods are created with node.kubernetes.io/not-ready and unreachable NoExecute tolerations of '
      + `${CLAIM_VALUES.tolerations.defaultSeconds}s, so they stay bound five minutes after a node is lost.`,
    source: `${K8S_DOCS}concepts/scheduling-eviction/taint-and-toleration/#taint-based-evictions`,
    coverage: 'modeled',
    modelNote:
      'The tolerations are stamped exactly (with their NoExecute effect), and '
      + 'the countdown they gate shipped at M8: expiry evicts (NodeLost) and '
      + 'the scheduler rebuilds elsewhere.',
    values: 'tolerations',
    usedBy: ['sim/apiserver'],
  },
  {
    id: 'node.monitor',
    statement:
      `The node lifecycle controller checks every ${CLAIM_VALUES.nodeMonitor.periodSeconds}s and marks a node `
      + `NotReady after ${CLAIM_VALUES.nodeMonitor.graceSeconds}s without a heartbeat (current default; historically 40s).`,
    source: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/',
    coverage: 'exact',
    values: 'nodeMonitor',
    usedBy: ['sim/nodes'],
  },
  {
    id: 'kubelet.heartbeat',
    statement:
      `The kubelet renews its Lease every ${CLAIM_VALUES.kubeletHeartbeat.leaseRenewSeconds}s — a quarter of the `
      + `${CLAIM_VALUES.kubeletHeartbeat.leaseDurationSeconds}s lease duration — while the Node .status heartbeat `
      + `runs only every ${CLAIM_VALUES.kubeletHeartbeat.statusReportSeconds / 60} minutes.`,
    source: 'https://kubernetes.io/docs/reference/node/node-status/#heartbeats',
    coverage: 'exact',
    values: 'kubeletHeartbeat',
    usedBy: ['sim/nodes', 'sim/objects'],
  },
  {
    id: 'controller.expectations',
    statement:
      'Controller expectations — in-flight creates/deletes a desk is waiting to observe — expire after '
      + `${CLAIM_VALUES.controllerExpectations.ttlSeconds / 60} minutes (ExpectationsTimeout), so a lost event can `
      + 'never stall reconciliation forever.',
    source: 'https://github.com/kubernetes/kubernetes/blob/master/pkg/controller/controller_utils.go',
    coverage: 'exact',
    values: 'controllerExpectations',
    usedBy: ['sim/controllers/replicaset', 'sim/controllers/deployment'],
  },
  {
    id: 'kubelet.sync',
    statement:
      'The kubelet re-synchronizes running containers with desired state at most every '
      + `${CLAIM_VALUES.kubeletHeartbeat.syncFrequencySeconds}s even without watch events.`,
    source: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
    coverage: 'exact',
    values: 'kubeletHeartbeat',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'images.pullSerialized',
    statement: 'The kubelet pulls images one at a time per node by default (serializeImagePulls).',
    source: 'https://kubernetes.io/docs/reference/config-api/kubelet-config.v1beta1/',
    coverage: 'exact',
    values: 'imagePull',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'images.pullPolicy',
    statement:
      'Omitting imagePullPolicy defaults to Always for :latest or untagged images, and IfNotPresent '
      + 'otherwise — including digest-pinned images.',
    source: `${K8S_DOCS}concepts/containers/images/#imagepullpolicy-defaulting`,
    coverage: 'modeled',
    modelNote:
      'The default is stamped exactly at admission, but the kubelet does not '
      + 're-pull on container restart even under Always — restarts reuse the '
      + 'cached image (FIDELITY.md).',
    usedBy: ['sim/apiserver'],
  },
  {
    id: 'deploy.rollingDefaults',
    statement:
      `A RollingUpdate Deployment defaults to maxSurge ${CLAIM_VALUES.rollingUpdate.surgePct}% `
      + `(rounded up) and maxUnavailable ${CLAIM_VALUES.rollingUpdate.unavailablePct}% `
      + '(rounded down) of the desired replica count.',
    source: `${K8S_DOCS}concepts/workloads/controllers/deployment/#rolling-update-deployment`,
    coverage: 'exact',
    values: 'rollingUpdate',
    usedBy: ['core/types'],
  },
  {
    id: 'deploy.rolloutTrigger',
    statement:
      'A rollout happens if and only if .spec.template changes. Scaling a Deployment '
      + 'does not create a new ReplicaSet or a new revision.',
    source: `${K8S_DOCS}concepts/workloads/controllers/deployment/#updating-a-deployment`,
    coverage: 'exact',
    usedBy: ['sim/controllers/deployment'],
  },
  {
    id: 'images.backoffCap',
    statement:
      `Failed image pulls retry on a backoff starting at ${CLAIM_VALUES.imagePull.backoffBaseSeconds}s `
      + `and doubling to a ${CLAIM_VALUES.imagePull.backoffCapSeconds}s cap — ErrImagePull on the `
      + 'failure, ImagePullBackOff while waiting.',
    source: `${K8S_DOCS}concepts/containers/images/`,
    coverage: 'exact',
    values: 'imagePull',
    usedBy: ['sim/kubelet'],
  },
  {
    id: 'etcd.compaction',
    statement:
      `The API server requests etcd compaction every ${CLAIM_VALUES.etcdCompaction.intervalSeconds}s by default, `
      + 'compacting to the previous interval\'s revision; watchers older than that must relist.',
    source: 'https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/',
    coverage: 'exact',
    values: 'etcdCompaction',
    usedBy: ['sim/etcd'],
  },
  {
    id: 'watch.bookmarks',
    statement:
      `Idle watchers advance by periodic bookmarks (~${CLAIM_VALUES.modelWatch.bookmarkSeconds} model s here); `
      + 'real bookmarks are opt-in, roughly once a minute, and clients may not assume any interval.',
    source: `${K8S_DOCS}reference/using-api/api-concepts/#watch-bookmarks`,
    coverage: 'modeled',
    modelNote: 'Cadence is a model number chosen to be far inside the compaction interval.',
    values: 'modelWatch',
    usedBy: ['sim/apiserver'],
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
  {
    id: 'slice.conditions',
    statement:
      'EndpointSlice endpoints carry serving and terminating conditions; ready means '
      + 'serving and not terminating, and proxies normally ignore terminating endpoints.',
    source: `${K8S_DOCS}concepts/services-networking/endpoint-slices/#conditions`,
    coverage: 'modeled',
    modelNote:
      'Conditions are computed and consumed exactly; slices are unbounded in the '
      + 'model (no 100-endpoint packing) and there is one slice per Service.',
    usedBy: ['sim/controllers/endpointslice'],
  },
  {
    id: 'crd.registration',
    statement:
      'A CustomResourceDefinition registers a new kind with the API server; applying a custom '
      + 'resource whose kind is not registered is rejected ("no matches for kind"). Registration '
      + 'creates storage and validation only — no controller appears with it.',
    source: `${K8S_DOCS}concepts/extend-kubernetes/api-extension/custom-resources/`,
    coverage: 'modeled',
    modelNote:
      'Registration gates admission by kind-match only; the OpenAPI schema in '
      + 'the shown CRD manifest is not evaluated by the model.',
    values: 'crd',
    usedBy: ['sim/apiserver', 'sim/objects'],
  },
  {
    id: 'crd.operator',
    statement:
      'An operator is an ordinary client: a controller process holding a watch on a custom '
      + 'kind and reconciling it. Built-in kinds ship with controllers; custom kinds are '
      + 'reconciled only while someone runs one.',
    source: `${K8S_DOCS}concepts/extend-kubernetes/operator/`,
    coverage: 'exact',
    usedBy: ['sim/controllers/lighthouse'],
  },
  {
    id: 'model.lighthouse',
    statement:
      `The Lighthouse burns ${CLAIM_VALUES.modelLighthouse.fuelDecayPctPerSec}% fuel per model second and its `
      + `operator refuels below ${CLAIM_VALUES.modelLighthouse.refuelBelowPct}% — model numbers chosen so drift `
      + 'is watchable. The mechanism (desired state decays; only a running reconciler corrects it) is the claim.',
    coverage: 'modeled',
    modelNote:
      'Fuel, decay rate, and refuel travel are inventions of this model; real custom resources '
      + 'drift for their own domain reasons.',
    values: 'modelLighthouse',
    usedBy: ['sim/controllers/lighthouse', 'world/harbor'],
  },
] as const

/** Fast lookup; the structural test asserts ids are unique. */
export const CLAIM_BY_ID: ReadonlyMap<string, K8sClaim> = new Map(CLAIMS.map((c) => [c.id, c]))
