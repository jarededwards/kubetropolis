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
  terminating scheduled pod is a no-op (`--force --grace-period=0` is not
  modeled).
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
  failure injection arrives with chaos wiring (M4).
- **restartPolicy** as a field (Always semantics are implicit).
- **Probe timeoutSeconds** (stated in stamped defaults, not modeled).
- **Taint-based eviction**: the stamped 300s tolerations gate an eviction
  countdown that arrives at M8.

*This file grows as the model does; it is enforced by the claims spine from M3.*
