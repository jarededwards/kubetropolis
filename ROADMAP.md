# Kubetropolis roadmap

Epic ledger for github.com/jarededwards/kubetropolis (public since
2026-08-03; milestone branches merge to main via pull request). Architecture,
milestone detail, and process live in the repo docs: CLAUDE.md, FIDELITY.md,
VENDORED.md, KNOB-AUDIT.md.

## Milestones

- [x] **M0 — Scaffold + vendor + first light** *(completed 2026-08-02, PO
      signed off 2026-08-03)* — vendored engine at 6d2c854;
      identity/legal files; island plate + sky render at `vite preview`;
      shoot.mjs screenshot clean (zero exceptions, probe healthy);
      typecheck + 130/130 tests + build green; legal checklist 1–8 done.
      Known TV artifact: Postgres district tints/labels on the ground come
      from the temporarily-verbatim layout.ts and vanish at M2.
- [x] **M1 — The cluster ticks** *(2026-08-03)* — deterministic sim core (etcd, apiserver,
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
- [x] **M3 — Flagship trace** *(2026-08-03)* — 12-stop pod rail + 14-stop
      deployment rail (trips-through-City-Hall counter as the lesson);
      step/slow/live deterministic; ONE narration card; action picker with
      YAML receipts + fidelity sentence; flows moving on the roads (couriers,
      work orders, bind writes, pull trucks); claims-copy enforcement live;
      201/201 tests; 12-shot verified strip.
- [x] **M4 — Workloads act** *(2026-08-03)* — readiness-gated rolling updates
      w/ claim-backed surge/unavailable pacing (proofs: ≤4/≥3 @ 3 replicas,
      rollback reuses the old RS); chaos paths real (crashloop, persistent OOM
      leak, registry outage w/ ErrImagePull→ImagePullBackOff ladder, readiness
      flake); scenario engine w/ beats + non-modal operator decisions; picker
      at 5 actions w/ live victim receipts; fog bank + hash tints + overflow
      strips; KNOB-AUDIT live (24 knobs); 232/232 tests.
- [x] **M5 — Tour v1** *(2026-08-03)* — six chapters live (orientation, apply,
      reconcile w/ on-camera delete+self-heal, zoning, rollout w/ undo button,
      closing) on the one narration card; your-turn gating proven; first-run
      invitation chip; byte-identical tour determinism; 239/239 tests.
- [x] **M6 — Services, ingress, traffic** *(2026-08-03)* — Service/
      EndpointSlice + endpointslice desk + per-district proxy views w/ real
      skewed lag; junction + off-ramp + gantry built; served/misrouted/refused
      counters; the 9-stop delete rail w/ concurrent WITHDRAW+SIGTERM stops
      and the try-the-fix preStop button (misroutes 21 → 0, test-asserted);
      ch6 + rollout-surge + readiness-flake scenarios; 259/259 tests.
- [x] **M7 — CRD & operator** *(2026-08-03, merged as PR #1)* — CRDs
      first-class (real rejection error pre-CRD; City Hall permits window);
      apply-crd + apply-lighthouse rails w/ held SHACK stop + staff button;
      operator on the provably longest road; fuel drift vs stale ledger;
      ch. 7 + paper-law scenario; 274/274 tests.
- [x] **M8 — Chaos + polish** *(2026-08-03)* — taint-based eviction w/ the
      honest two clocks (grace ~50s, toleration dial live); drain vs PDB
      (429 DENIED stamps; node-loss never consults the budget — drain does);
      HPA desk w/ 5m stabilization spike; quota admission; leader flap w/
      the-city-still-serves; ten-chapter tour; 12 scenarios; 10 actions;
      500 pods @ GPU-class fps; native touch; five art debts paid;
      282/282 tests. Light bake deferred (ROADMAP note).

Budget pressure valve: trim M8 extras (etcd-slow/quota scenarios, bake polish).
Never M7.

Post-v1 art item: the offline indirect-light bake (`npm run bake:light`) was
deliberately deferred — tooling is vendored and dormant; run it against final
geometry when the art pass warrants it.

## v1 exclusions (deliberate)
Walk mode · audio · free-text YAML parsing · real-cluster connection ·
StatefulSets/PV/PVC (anchors reserved) · secondary app entries · analytics.

## Naming
"Kubetropolis" chosen to contain no third-party mark. Fallback candidates if
ever needed: ClusterCity, KubeCity.

## v1.1 backlog (from the v1 review panel — recorded, not implemented)

- Fidelity A2: Services select pods by ownerRef in the model; real selection
  is label-based — model labels/selectors when a second workload exists.
- Fidelity A5: PDB/ResourceQuota status fields (currentHealthy, used/hard)
  are partial; surface fuller policy status in inspectors.
- Fidelity A6: client-submitted status on create is accepted rather than
  wiped; wipe it at admission like the real registry.
- Fidelity A7: the scheduler reads node imageCache directly (kubelet-local
  truth); real ImageLocality scores from Node.status.images.
- Fidelity A9: terminating endpoints fall back to serving when no ready
  endpoint remains (real proxies' terminating fallback) — not modeled.
- Fidelity A12: assorted copy/mechanism micro-notes (see the v1 panel report
  in the PR #3 description).
- Light bake (tools/bake-indirect.mjs) against final geometry — deferred.
- Day-theme beam falloff polish if the v1 gradient needs tuning.

## v1.0.0 — released 2026-08-03

Review panel (fidelity · operations · reader-experience) each returned
FIX-FIRST; all blocking findings across the three reports plus the product
owner's independent Apache-2.0 audit were resolved on feat/v1-punchlist
(merged as PR #3). Panel consensus on the core: no wrong claim values;
pacing arithmetic, eviction asymmetry, preStop-inside-grace, and the
delete-race mechanics verified correct. Remaining advisories live in the
v1.1 backlog above.
