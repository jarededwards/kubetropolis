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

*This file grows as the model does; it is enforced by the claims spine from M3.*
