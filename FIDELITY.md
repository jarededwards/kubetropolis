# Fidelity boundary

Kubetropolis is a model of Kubernetes, not an emulator. No Kubernetes source
code runs in this application and no real cluster is contacted. Numbers are
deliberately time-scaled so mechanisms are watchable; scaled values are labeled
"model" values in copy, and every reader-visible fact resolves to a sourced
claim in `src/core/claims.ts`.

**The complete v1 grammar is the canned action set.** Free-form YAML would
imply behavior this model does not have.

## Deliberately not modeled (v1)

- Real YAML/OpenAPI validation — canned manifests only
- RBAC and authentication beyond a stamped admission step
- CNI, iptables/IPVS, and DNS internals — Services are modeled as a routing
  directory with propagation delay, which is the shape of the lesson
- cgroups — memory is one number compared against one limit
- Multi-container pods beyond a single optional init container (no sidecars,
  no QoS-class edge cases)
- StatefulSets, PersistentVolumes/Claims (geography reserved for v2)
- Priority and preemption; affinity beyond a spread-lite score
- Admission webhooks as external servers; API aggregation
- Leader election of controllers (etcd leader + quorum only; no raft log
  internals or split-brain resolution)
- Real resource metrics — CPU usage is synthesized from request traffic

The scheduler is presented as "a subset of the scheduling framework": three
filter plugins and three score plugins carrying their honest upstream names.

## Corrected by the M1 fidelity review (M1.5)

Ten blocking findings from an independent Kubernetes-semantics review were
fixed rather than disclosed — the model now matches real behavior for: preStop
running INSIDE the grace period (with the real one-off 2s extension);
generation bumping on any spec change (a scale bumps it; only a template
change makes a rollout); NotReady nodes carrying `unreachable` NoSchedule +
NoExecute taints that the scheduler filters on key+effect; scoring counting
assumed pods; strict head-of-line etcd commit ordering; controller
expectations expiring on the 5-minute ExpectationsTimeout with a periodic
resync; repeat deletes being no-ops on terminating pods; pods on a silent
node being marked unready (MarkPodsNotReady); the kubelet heartbeat story
(Lease every 10s, `.status` every 5 minutes); and timeScale varying the
number of fixed steps, never their size.

## Modeled simplifications (M1)

- **Status subresource as merge semantics.** Writes are split into `update`
  (merges spec/labels/generation) and `updateStatus` (merges status);
  `deletionTimestamp` is irreversible. This stands in for the real status
  subresource plus optimistic concurrency — there are no 409 conflicts or
  client retries in the model.
- **Desks read the vault directly.** Controllers wake on courier deliveries
  (the honest hop) but read current state rather than a lagged informer
  cache; their in-flight expectations are pruned in that same read frame.
- **Scheduler**: one pod per cycle; assumed-pods reserve cache; binding is a
  plain spec write, not the pods/binding subresource.
- **ReplicaSet victim ranking** is newest-first by uid (the real ranking
  weighs readiness, node spread, and pod-deletion-cost); creates are filed in
  capped batches of 3 rather than real slow-start doubling.
- **etcd quorum** is abstracted into one fsync latency under a fixed leader;
  compaction forces lagging watchers to relist, and healthy watchers advance
  by bookmarks.
- **One container per pod** (plus an optional init container, unwired at M1).

## Modeled simplifications (M3)

- **Image layers are two-tier.** A pull has 5–7 layers; a cached image of the
  same repository counts as shared base layers and shrinks the transfer to
  the top two. Real layer graphs are arbitrary DAGs — the modeled lesson
  (same-repo upgrades pull fast on warm districts) survives, the topology
  does not.
- **The trace counts trips off the etcd log.** If a compaction trims the log
  mid-trace (5-model-minute interval vs ~15-model-second traces), trips can
  undercount; the narration would still be ordered correctly.
- **Repeat-delete nuance**: a second delete with a SHORTER grace period would
  truncate termination in real Kubernetes; here every repeat delete on a
  terminating scheduled pod is a no-op. `--force --grace-period=0` IS modeled
  as its own command (the row is removed without the foreman's confirmation)
  and is offered — with its warning — as a scenario decision.
- **Node Ready=False path**: heartbeat loss yields Ready=Unknown +
  `unreachable` taints (implemented). A reachable-but-unhealthy kubelet would
  yield Ready=False + `not-ready` taints — that path awaits a kubelet-health
  chaos knob.
- **Scheduler backoff** is a flat 5 model-seconds; the real queue backs off
  exponentially from 1s to 10s per pod, with periodic flushes.
- **Restarts skip the image pull**: a restarting container reuses the cached
  image even under `imagePullPolicy: Always`, understating registry load in
  crash loops.
- **Relists do not synthesize deletions**: a watcher that relists replays
  present objects only; stale owner-index entries are pruned lazily rather
  than diffed against the store.
- **Compaction/bookmarks**: idle watchers advance by periodic model bookmarks
  (~60 model s); real bookmarks are opt-in and unguaranteed. Compaction
  retains one interval of history, like kube-apiserver's compactor.

## Absent (disclosed by claims with coverage 'absent')

- ~~Image pull failures~~ **Built at M4**: a pull against an unreachable
  registry fails after a short connect window into ErrImagePull, then waits
  out an ImagePullBackOff ladder (10s doubling to the 300s cap — claims:
  images.backoffCap); districts holding the image keep building from the
  shelf. Superseded text below kept for the record:
- **Image pull failures (pre-M4)**: no ErrImagePull / ImagePullBackOff path yet — a
  registry outage stalls the crane instead of erroring (arrives with the
  image-pull-storm scenario, M4).
- **Liveness kill path**: probes run and readiness gates traffic; liveness
  ~~failure injection arrives with chaos wiring (M4)~~ — superseded at v1:
  `chaosLivenessFail` wires real liveness kills (SIGKILL, exit 137, the
  restart ladder). Liveness passes whenever the dial is off.
- **restartPolicy** as a field (Always semantics are implicit).
- **Probe timeoutSeconds** (stated in stamped defaults, not modeled).
- **Taint-based eviction**: the stamped 300s tolerations gate an eviction
~~countdown that arrives at M8.~~ Superseded at M8: the countdown shipped —
  toleration expiry evicts (NodeLost) and the scheduler rebuilds elsewhere.

## Modeled simplifications (M4)

- **The OOM leak is a chaos construct.** Only the demo `:v2` image leaks, at a
  fixed model rate. The kernel's check reads the kubelet's LOCAL working set;
  published status updates coarsely (real cadvisor-style sampling, simplified).
- **Readiness flake is windowed, not random**: 40-model-second bad windows
  alternating with good ones — deterministic, sized so failureThreshold can be
  crossed at the default probe period, and phase-staggered per pod (M6) so a
  flaking fleet never fails in lockstep and traffic genuinely reroutes.
- **Rolling updates**: "available" means Ready (no minReadySeconds);
  progressDeadlineSeconds and revision annotations are not modeled (the
  previous ReplicaSet is found by hash, kept at zero replicas); old contracts
  scale down oldest-first against a same-frame ready budget rather than the
  real proportional spread.
- **Both-zero pacing** (maxSurge=maxUnavailable=0) is clamped to surge 1 with
  a warning; real validation rejects the manifest outright.
- **Scenario knob restore is wholesale**: ending a scenario restores the knob
  set captured at entry — a knob you changed mid-scenario is restored away.

## Modeled simplifications (M6)

- **One Service, one EndpointSlice.** The demo Service selects the shopfront
  pods; the slice folds `endpoints` into spec so standard merge semantics and
  the generation-on-real-change rule apply. Real slices carry endpoints/ports
  at top level and shard at 100 endpoints.
- **Routing is junction round-robin + street truth.** The junction assigns each
  request a door by round-robin over the DIRECTORY's ready listings; whether
  the door serves is checked against the street (container state, SIGTERM,
  flake windows). Real kube-proxy DNATs per its own per-node programming with
  no central junction; the per-district programmed views exist and are what
  the signage renders — their lag is real, their role in packet paths is
  presentational. A request that reaches a non-serving listed door counts as
  MISROUTED; real clients see connection errors and retries, not a counter.
- **Arrivals are a deterministic accumulator**, not Poisson — determinism
  outranks statistical realism everywhere in this model.
- **Synthesized CPU**: each served request costs `reqCpuCostM` millicore-
  seconds, EMA-smoothed. There is no metrics-server; the substation needle IS
  the metric the future HPA reads.
- **The preStop knob applies at termination time** so "try the fix → re-run"
  teaches in one breath. Real preStop is pod spec fixed at admission; changing
  it is a template edit, and a template edit is a rollout. (The stamped spec
  value still appears in the admission receipt; the kubelet honors the larger
  of spec and knob.)
- **A flaking app fails its users in the same windows it fails its probes** —
  one deterministic signal drives both, which is the honest version of "your
  health check should mean something."
- **Repeat-delete nuance**: a second delete with a SHORTER grace period (which
  real Kubernetes honors) is not modeled; repeat deletes are no-ops.

## Modeled simplifications (M7 — CRDs and the operator)

- **CRD validation is kind-match only.** Registration checks that the kind
  exists; there is no OpenAPI schema validation, no versions, no conversion
  webhooks, no structural-schema rules. The rejection error is the real shape
  ("no matches for kind"), produced by the validating stage.
- **One CRD, one custom kind.** The model registers exactly
  `lighthouses.harbor.city`; the general machinery (any group/kind) is not
  modeled.
- **The operator's device loop.** While staffed, the operator sweeps its
  device every 2 model seconds (the controller-runtime RequeueAfter idiom) in
  addition to its watch — that is how construction completion, the fuel
  gauge, and refuel-truck arrivals are noticed. Status publishes in 5%
  buckets to avoid write amplification.
- **Street truth vs. published status.** The physical beacon (fuel, flame)
  lives outside the vault, like a container's working set; only the operator
  publishes status. Unstaffed, the ledger goes stale while the beacon drifts
  dark — deliberate, and the lesson.
- **Construction requires the operator.** An admitted Lighthouse row with no
  operator builds nothing (a law with no inspector is paper); the tower
  rises when the operator first reconciles it, the way pods become concrete
  only when a kubelet acts.
- **Fuel physics are inventions** (decay rate, refuel threshold, travel
  time) — claimed as model values (`model.lighthouse`), chosen so drift is
  watchable. An operator killed mid-refuel leaves the run incomplete until
  re-staffed.

## Modeled simplifications (M8 — self-healing and scale)

- **NodeLost removal.** After a toleration countdown expires on an
  unreachable district, the model removes the pod row in ONE write with a
  `NodeLost` event. Real pods linger `Terminating` until the Node object is
  deleted or someone forces the issue — no kubelet is alive to confirm the
  grace dance. The lesson (nothing rebuilds until the countdown runs out;
  then the contract rebuilds elsewhere) survives; the limbo does not.
- **Taint eviction skips the budget — faithfully.** NoExecute eviction is the
  node lifecycle controller acting directly; it is NOT an API-initiated
  eviction, so PodDisruptionBudgets do not protect against node loss
  (claims: `taint.eviction`). The model preserves this asymmetry on purpose:
  drains bounce off budgets with 429s; node loss does not ask.
- **The countdown is a dial, not history.** Armed countdowns expire at
  `armedAt + unreachableTolerationSec` read LIVE, so the self-heal chapter can
  shorten a running clock on camera. The stamped 300s stays on the admission
  receipt; the dial is the teaching surface.
- **Quota reserves at the counter.** The quota stage counts committed pods
  PLUS accepted-but-uncommitted creates (in-flight past the kiosk, and
  proposals in the vault queue) — the atomic reservation real quota admission
  performs. Only pod COUNT is modeled; cpu/memory quota is not.
- **Drain is a modeled client loop** (cordon, evict one building at a time,
  retry 429s with 5→30s doubling model backoff). Real kubectl drain
  parallelism, `--ignore-daemonsets` semantics (no DaemonSets exist here),
  and grace flags are out of scope.
- **HPA metrics are synthesized.** Utilization is the model's per-pod CPU EMA
  from live request traffic — there is no metrics-server, no scrape interval,
  no container-level metrics. The formula, deadband, sync period, and
  downscale stabilization window carry their real defaults (claims:
  `hpa.formula`, `hpa.sync`, `hpa.stabilization`); scale-up has no
  stabilization window, matching the real default.
- **Leader flap is a caricature with honest consequences**: deterministic
  4-second elections every 25 model seconds during which nothing commits and
  the leader lamp hops chambers. No raft internals, no split brain — only the
  true observable: a cluster that cannot write can still serve.


## Corrected and disclosed at the v1 review panel

- **The admission desk stamps more than real Kubernetes does.** Every Pod
  receives a readiness probe, a liveness probe, and a memory limit at
  admission. Real Kubernetes injects none of these — a Pod with no probes and
  no limits is legal and common. The model stamps them so every building can
  teach probe and limit behavior; the shown manifests now declare the probe
  and limits explicitly so what you read matches what runs.
- **Network partitions are not modeled.** `chaosNodeFail` cuts power — the
  district is genuinely dead, so force-delete looks free here. In production,
  "unreachable" means the control plane cannot tell a dead node from a live
  one behind a broken network; a partitioned node's containers keep running
  and keep writing. The force-delete decision copy carries this warning.
- **`imagePullPolicy: Always` is stamped but not honored on restart** — a
  restarting container reuses the cached image, understating registry load in
  crash loops during an outage (claim `images.pullPolicy` is graded `modeled`
  for this reason).
- **HPA omits two real scale-up guards**: not-yet-ready pods are not set
  aside conservatively, and there is no `behavior.scaleUp` rate limit
  (default: max of +100% or +4 pods per sync) — the model can jump 3→10 in
  one sync where real Kubernetes steps. Scale-down stabilization IS modeled.
- **Node-eviction rate limiting is absent**: `--node-eviction-rate` (0.1/s),
  the secondary zone rate, and the unhealthy-zone threshold that deliberately
  SLOW or STOP evictions during zone-level outages are not modeled — with
  three districts you could never see them fire.
- **`tolerationSeconds` acts as a live dial here**: real Kubernetes stamps it
  per pod at admission, so changing the default only affects new Pods; the
  model applies the dial to running countdowns so the arc is watchable.

*This file grows as the model does; it is enforced by the claims spine from M3.*
