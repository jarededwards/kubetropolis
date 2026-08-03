# VENDORED.md — provenance ledger

Source: **PGSimCity** — https://github.com/NikolayS/PGSimCity
Pinned commit: **`6d2c8543756538217d7a345c174a9e0cf85f5cad`** (2026-08-02, v0.36.2 era)
License: Apache-2.0, Copyright 2026 Nikolay Samokhvalov (LICENSE at repo root; NOTICE propagated)

Dispositions: **V** = verbatim (byte-identical against the pinned commit) ·
**A** = adapted (differs from upstream; carries an in-file change-notice
header). Every A-graded file below has the header; if you edit a V file,
regrade it here and add the header in the same commit.

## Root
| File | Disp | Notes |
|---|---|---|
| LICENSE | V | Apache-2.0 text, upstream copyright intact |
| NOTICE | A | Upstream text kept (PGlite paragraph omitted — not bundled, omission noted in-file); Kubetropolis block appended |
| tsconfig.json | V | |
| vite.config.ts | A | Single entry; PGlite plugin/optimizeDeps removed; env/defines renamed; guard + test rationale kept |
| index.html | A | Structure kept (theme bootstrap, mounts, boot screen); all copy/marks replaced; og/social meta ours |

## src/core
types.ts **A** (Kubernetes contract replaced the Postgres SimState/Knobs at M1;
residual TV-legacy constants deleted at v1) · bus.ts V · registry.ts V ·
timebase.ts(+test) **A** (timeScale varies the NUMBER of fixed steps per frame,
never the step size) · theme.ts(+test) V · themes.ts(+test) **A** (theme
localStorage key) · util.ts(+test) V · beveled-box.ts(+test) V ·
build.ts **A** (define names) · city-route.ts(+test) V ·
claims.ts **A** (rewritten — Kubernetes claims registry, mechanism inherited) ·
destinations.ts **A** (+test **A**) (destinations re-pointed to Kubetropolis
districts) · model-helpers.ts **A** (K8s trace-stop bitmask) · route-ids.ts V ·
trace-presentation.ts **A** (K8s apply-journey stops)

Deleted along the way: catalog.ts (M2, orphaned by the layout rewrite) ·
src/spine/ (M1, only the Postgres claims imported it)

## src/engine
renderer.ts(+test) **A** (glow anchors re-pointed; internal names de-branded) ·
camera.ts **A** (+camera-controls.test **A**) (world/plan import; overview
toast; test ceiling constant + plan mock) ·
collision.ts V (collision.test.ts deleted — drove the unvendored walk
controller) · color-grade.ts(+test) **A** (internal names) ·
flows.ts **A** (FlowKind vocabulary rewritten to Kubernetes flow kinds; pool/
route engine verbatim; wired M3) · label-detail.ts V ·
label-layout.ts(+test) V · labels.ts(+labels-occlusion.test) **A** (district
maps + exclusion ids re-keyed) · light-shafts.ts(+test) **A** (internal names) ·
picker.ts(+test) **A** (district colors) · roads.ts V-inert (unwired — the
vendored street grid followed the Postgres layout; Kubetropolis routes render
via flows) · water.ts **A** (harbor sea sizing; internal names) ·
audio.ts **A** (storage key; walk-mode dependency, never wired)

## src/world (vendored files only — districts are original, below)
sky.ts(+test) **A** (Beacon asterism replaces the elephant; island commentary) ·
ground.ts **A** (imports ./plan; Kubetropolis plinths/decals; records-pit cut) ·
ground-surface.ts(+test) V · plate-fog.ts V ·
plan.ts/plan.test.ts **A** (renamed copy of src/world/slonik.ts — ring math
verbatim; elephant outline replaced by the original island outline)

## src/ui (vendored files only)
uikit.ts V · boot.ts(+test) **A** (Kubetropolis boot ladder; monotonicity
assertion) · legal.ts **A** (rewritten — K8s notice replaces EA notice)

touchpad.ts: NOT vendored (final) — it is a walk-mode joystick; Kubetropolis
ships native camera touch instead (M8).

## src/styles
All 12 CSS files V.

## test (vendored files only)
dom.ts V · sim-boundary.test.ts V · trademark-notice.test.ts **A** (K8s
notice + help surface) · camera-floor.test.ts V ·
build-metadata.test.ts V (byte-identical — the define rename lives in
core/build.ts, not the test) · cdp-profile.test.ts V · cdp-run.test.ts V

## tools
shoot.mjs **A** (gate path env-overridable; Chrome auto-detect on macOS;
KUBETROPOLIS probe) · cdp-profile.mjs **A** (profile root; `ps` fallback for
hosts without /proc) · cdp-run.mjs V · reap.sh **A** (gate path) ·
reap-cdp-profiles.mjs V · bake-indirect.mjs **A** (gate path + probe) ·
verify-hud-layout.mjs **A** (rewritten lean on the upstream CDP harness)

## Original Kubetropolis files (not vendored; Apache-2.0, this project)
- src/main.ts — boot/loop orchestration written for Kubetropolis on the
  upstream main.ts pattern (declares its derivation in-file)
- src/sim/** — the entire Kubernetes model (all files + tests)
- src/world/ — layout.ts, control-plane.ts, node-district.ts, harbor.ts,
  ingress.ts
- src/ui/ — hud.ts, panel.ts, search.ts, help.ts, debug-overlay.ts,
  narration.ts, trace-ui.ts, trace-copy.ts, action-picker.ts, scenario-ui.ts,
  tour.ts, tour-engine.ts
- test/ — claims-copy, claims-structure, narration, perf, tour,
  sim-determinism-sources

## Not vendored (deliberate)
Postgres world districts (access, backends, clients, continuity,
control-center, maintenance, planner, replication, shmem, storage, wal,
silhouette, handles, baked-light*, slonik under its own name) · Postgres
sim/prose/chrome (model.ts, scenarios.ts, anatomy, docs-*, content, tour,
trace-copy, help, hud, panel, controls, search, context-menu, control-center*,
zoom-context, walk-up, world-handles, mode-exits, trace-dwell — all rewritten
as original files above) · walk mode (engine/walk, hands, swimming tests) ·
observability/ · machine/ · public/* assets (elephant mark) · analytics ·
corrections/replication core modules · package-lock.json

## Re-sync procedure (engine/ and tools/ only; optional)
```
git clone https://github.com/NikolayS/PGSimCity.git /tmp/pgsc && cd /tmp/pgsc
git diff 6d2c8543756538217d7a345c174a9e0cf85f5cad..origin/main -- src/engine tools
# port relevant hunks by hand; update the pin above; never add upstream as a remote
```
