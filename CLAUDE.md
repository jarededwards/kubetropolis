# CLAUDE.md — Kubetropolis

## Project
Kubetropolis is an explorable 3D city that teaches how Kubernetes works.
Buildings and motion represent real control-plane mechanisms; numbers are
deliberately scaled so people can watch those mechanisms operate. The city is
a model, not an emulator: no Kubernetes source code runs in this application,
and no real cluster is contacted. Use **Kubetropolis** in prose, `kubetropolis`
in package names.

The reader is technically capable but may be new to Kubernetes operations.
Explain precisely without assuming operator vocabulary, and disclose every
simplification that could change the lesson (see FIDELITY.md).

Milestones and epic status live in ROADMAP.md; the model's boundary is
FIDELITY.md; vendor provenance is VENDORED.md.

## Provenance
Portions derive from PGSimCity (github.com/NikolayS/PGSimCity, Apache-2.0,
Copyright 2026 Nikolay Samokhvalov), vendored at commit 6d2c854. VENDORED.md is
the per-file ledger. Keep LICENSE and NOTICE with distributions; adapted files
carry a change-notice header. Do not remove either.

## Architecture (five layers, one contract)
- src/core/types.ts defines SimState — the only meeting point of sim and world.
- src/sim owns and mutates simulation state. It NEVER imports three.js.
  test/sim-boundary.test.ts enforces this on the runtime import closure of
  src/sim/model.ts; keep model.ts the facade that reaches every sim module.
- src/world reads SimState and builds geometry. It NEVER mutates SimState.
- src/world/layout.ts is the single owner of geography: CITY dims, named
  ANCHORS, ROUTES. No district hard-codes a coordinate another district needs.
  New cross-district positions go in layout.ts first, then are consumed.
  (src/world/plan.ts owns only the island outline the plate is cut to.)
- src/engine renders; src/ui explains. Neither becomes a second simulator.
- One requestAnimationFrame loop lives in src/main.ts:
  timebase.advance → world update(dt, simState, t) → flows.update → render →
  labels → HUD. Nothing else schedules work.
- All cluster mutations enter through one typed command surface,
  sim.apply(command); the sim's watch machinery delivers change records
  (ADDED|MODIFIED|DELETED) whose payload is the current materialized object —
  desks read the vault at reconcile time (see FIDELITY.md). This keeps the v2
  "read-only live cluster" seam open. kubectl is just another client.

## Determinism (non-negotiable)
- No Date.now, Math.random, setTimeout/setInterval, performance.now, or any
  wall-clock/randomness source anywhere in src/sim. Use the seeded RNG from
  src/core/util.ts. A grep-based test enforces this.
- The model advances only via fixed steps (MODEL_STEP_SECONDS in
  src/core/timebase.ts) from bounded wall time. Same seed + same commands +
  same step count must yield deep-equal SimState on every machine. Scheduler
  ties break deterministically.
- Tests never depend on wall-clock timing, a browser, or a GPU when the claim
  is pure.

## Frame discipline
Per-frame paths allocate nothing. Reuse vectors, colors, arrays, scratch
objects, materials. All pods of an archetype render through one InstancedMesh;
all flow packets through the engine/flows.ts pool. If you need a new mesh per
object per frame, the design is wrong.

## Kubernetes truth rules
- Every number or mechanism shown to the reader is a claim. Claims live in
  src/core/claims.ts with a source (kubernetes.io docs or KEP link) and are
  enforced by the claims-spine test. Building, tooltip, tour, scenario, and
  test must all read the claim registry — never inline a duplicate number.
- Scaled values are labeled "model" values. A mechanism the model does not
  implement is marked coverage: 'absent' and listed in FIDELITY.md. Prose must
  not promise what the model cannot show; a building must not teach what
  Kubernetes does not do. When prose and model disagree, deciding which is
  wrong is a separate act BEFORE editing either.
- Kubernetes API vocabulary is exact: Pod, ReplicaSet, Deployment, Node,
  kubelet, kube-apiserver, etcd, kube-scheduler, controller manager, CRD,
  custom resource, reconcile. Say "control plane", not "master".
- Metaphor registers never mix inside one line of copy: civic language for
  control-plane concepts, nautical language only for the harbor/registry and
  Kubernetes' own proper nouns.

## UI restraint
- ONE narration card, lower third. Tour, trace, and scenarios all speak through
  it. No second voice, ever.
- At most one side panel open; opening another closes the first. No modal
  popups. Toasts: max one visible, auto-expiring.
- The 3D city is the product; chrome yields to it. Any new UI surface needs a
  layout-verifier rule before merge (tools/verify-hud-layout.mjs, from M2).
- Tour chapters: max 45 seconds each, and each ends with a "your turn" action
  the reader performs, not watches.

## Trademarks
- The Kubernetes/Linux Foundation notice in src/ui/legal.ts appears verbatim in
  index.html and (from M2) the help overlay; test/trademark-notice.test.ts
  enforces it.
- NEVER use the Kubernetes helm-wheel logo — no seven-spoked wheel in any
  asset, favicon, or og image. Never imply CNCF/Linux Foundation affiliation.
- No SimCity code, assets, artwork, logos, audio, or game content, ever. The
  project name deliberately contains no third-party mark.

## Dependency boundary
three.js is the only bundled runtime dependency. No framework, CDN resource,
remote font, binary asset, analytics, or telemetry. The site is fully static
and makes zero application network calls.

## Agentic engineering rules
- Red/green TDD is mandatory for fixes. Every fix starts with the smallest
  deterministic failing test; confirm it fails for the expected reason first.
- Verify the deliverable: npm test, npm run typecheck, npm run build before
  handoff. New code must be imported, constructed, and called — grep for the
  wiring. Visible changes require a read screenshot via tools/shoot.mjs, not a
  render command that exited 0.
- At most two headless browsers, always through tools/shoot.mjs (directory
  semaphore; do not raise CDP_MAX, do not launch Chrome around it).
- Cross-cutting files — src/engine/renderer.ts, src/main.ts,
  src/world/layout.ts, src/core/types.ts — are edited only in a dedicated
  worktree. Never use git stash to isolate work.
- The remote is github.com/jarededwards/kubetropolis. Push feature branches;
  NEVER push main — main moves only via pull request, merged by the project
  owner's process. Commit in your own worktree on your own branch.
  Conventional Commits; subject under 50 chars; no co-author trailers.
- A milestone is not closed until an independent review panel (fidelity lens,
  operations lens, reader-experience lens) has REPORTED, not merely been
  dispatched, and the Product Owner has signed off. Blocking findings block.
- window.KUBETROPOLIS exposes sim, bus, rig, registry, gfx, flows for headless
  staging. Screenshots stage views through it; they never poke internals.
