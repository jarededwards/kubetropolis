# Kubetropolis roadmap

Local epic ledger (no remote by product-owner decision, 2026-08-02; migrate to
issue tracking if hosting is chosen). Full plan:
`~/.claude/plans/https-github-com-nikolays-pgsimcity-ref-enumerated-stallman.md`.

## Milestones

- [x] **M0 — Scaffold + vendor + first light** *(completed 2026-08-02, PO
      signed off 2026-08-03)* — vendored engine at 6d2c854;
      identity/legal files; island plate + sky render at `vite preview`;
      shoot.mjs screenshot clean (zero exceptions, probe healthy);
      typecheck + 130/130 tests + build green; legal checklist 1–8 done.
      Known TV artifact: Postgres district tints/labels on the ground come
      from the temporarily-verbatim layout.ts and vanish at M2.
- [ ] **M1 — The cluster ticks** — deterministic sim core (etcd, apiserver,
      scheduler, deployment/replicaset controllers, kubelet lifecycle);
      `KUBETROPOLIS.sim.apply(samplePod)` walks Pending→Running in a debug
      overlay; ~200 tests; determinism deep-equal; claims scaffold live.
- [x] **M2 — First-light city** *(2026-08-03)* — Kubetropolis geography live
      (civic campus + vault-at-origin, zoning, 6 inspector desks, 3 node
      districts + reserves, harbor w/ crane+ship+breakwater); pods = 3 draw
      calls citywide; HUD/panel/search/help + layout verifier @ 4 viewports;
      probe 96/96 pods ready @ GPU-equiv 60fps; 169/169 tests. Postgres TV
      geography deleted. Art-pass debts logged for M8 (water read, top-bar
      cramp, decal mirroring, 36-pad visual cap).
- [ ] **M3 — Flagship trace** — the 12-stop narrated `kubectl apply -f pod.yaml`
      journey; step/slow/live; claims spine enforcing.
- [ ] **M4 — Workloads act** — scale/rolling-update/delete-pod actions;
      scenario runtime + steady-state, crashloop, oomkill, image-pull-storm;
      KNOB-AUDIT.md begins.
- [ ] **M5 — Tour v1** — runner + chapters 1–5 & 10 with on-camera actions.
- [ ] **M6 — Services, ingress, traffic** — readiness-gated request flows;
      delete-race trace variant; chapter 6.
- [ ] **M7 — CRD & operator (core scope; never the cut)** — Lighthouse
      CRD/CR/operator, dark-breakwater moment; chapter 9.
- [ ] **M8 — Chaos + polish** — drain/kill node, HPA; chapters 7–8; five more
      scenarios; light bake; mobile pass; perf 500 pods; review panel reports.

Budget pressure valve: trim M8 extras (etcd-slow/quota scenarios, bake polish).
Never M7.

## v1 exclusions (deliberate)
Walk mode · audio · free-text YAML parsing · real-cluster connection ·
StatefulSets/PV/PVC (anchors reserved) · secondary app entries · analytics.

## Naming
"Kubetropolis" chosen to contain no third-party mark. Fallback candidates if
ever needed: ClusterCity, KubeCity.
