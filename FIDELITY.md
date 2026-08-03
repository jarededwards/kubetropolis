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

*This file grows as the model does; it is enforced by the claims spine from M3.*
