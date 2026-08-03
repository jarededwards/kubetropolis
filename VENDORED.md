# VENDORED.md — provenance ledger

Source: **PGSimCity** — https://github.com/NikolayS/PGSimCity
Pinned commit: **`6d2c8543756538217d7a345c174a9e0cf85f5cad`** (2026-08-02, v0.36.2 era)
License: Apache-2.0, Copyright 2026 Nikolay Samokhvalov (LICENSE at repo root; NOTICE propagated)

Dispositions: **V** = verbatim (byte-identical at vendor time) · **A** = adapted
(carries a change-notice header) · **TV** = temporarily verbatim (Postgres
domain content retained inert until the noted milestone replaces it).

## Root
| File | Disp | Notes |
|---|---|---|
| LICENSE | V | Apache-2.0 text |
| NOTICE | A | Upstream text kept (PGlite paragraph removed — not bundled); Kubetropolis block appended |
| tsconfig.json | V | |
| vite.config.ts | A | Single entry; PGlite plugin/optimizeDeps removed; env/defines renamed; guard + test rationale kept |
| index.html | A | Structure kept (theme bootstrap, mounts, boot screen); all copy/marks replaced |

## src/core (all V unless noted)
types.ts **(TV → M1: SimState/Knobs replaced with Kubernetes contract)** ·
bus.ts · registry.ts · timebase.ts(+test) · theme.ts(+test) **(TV palette → M2 retint)** ·
themes.ts(+test) · util.ts(+test) · beveled-box.ts(+test) · build.ts **(A: define names)** ·
city-route.ts(+test) · claims.ts **(TV → M1: Postgres claims emptied)** ·
destinations.ts(+test) · model-helpers.ts · route-ids.ts · trace-presentation.ts

## src/engine
renderer.ts(+test) **(A-light: debug strings)** · camera.ts(+camera-controls.test) **(A: imports ../world/plan)** ·
collision.ts(+test) V · color-grade.ts(+test) V · flows.ts V · label-detail.ts V ·
label-layout.ts(+test) V · labels.ts(+labels-occlusion.test) V · light-shafts.ts V(+test) ·
picker.ts(+test) V · roads.ts V · water.ts V · audio.ts V-inert (dependency of
collision.ts; walk mode not vendored, audio never wired)

## src/world
layout.ts **(TV → M2: full Kubetropolis geography replaces Postgres city)** ·
sky.ts(+test) **(TV: asterism/atmosphere; renamed constants at M2 art pass)** ·
ground.ts **(A: imports ./plan)** · ground-surface.ts(+test) V · plate-fog.ts V ·
**plan.ts / plan.test.ts (A: renamed copy of upstream src/world/slonik.ts —
generic ring math kept verbatim; the elephant outline path replaced with the
Kubetropolis island outline with western harbor bay)**

## src/ui
uikit.ts V · boot.ts(+test) **(A: Kubernetes boot steps)** · touchpad.ts V ·
legal.ts **(A: rewritten — K8s notice replaces EA notice)**

## src/styles
All 12 CSS files V (retint via tokens at M2).

## test
dom.ts V · sim-boundary.test.ts V (entry src/sim/model.ts unchanged) ·
trademark-notice.test.ts **(A: K8s notice; help-overlay assertion returns M2)** ·
camera-floor.test.ts V · build-metadata.test.ts **(A: define names)** ·
cdp-profile.test.ts V · cdp-run.test.ts V

## tools
shoot.mjs **(A: gate path + window.KUBETROPOLIS probe)** · cdp-profile.mjs **(A: same)** ·
cdp-run.mjs V · reap.sh V · reap-cdp-profiles.mjs V · bake-indirect.mjs V (dormant
until M8 rebake) · verify-hud-layout.mjs **(A at M2: selectors re-pointed)**

## Not vendored (deliberate)
src/sim/** (Postgres model — rewritten as Kubernetes) · src/world districts
(access, backends, clients, continuity, control-center, maintenance, planner,
replication, shmem, storage, wal, silhouette, handles, baked-light*, slonik
under its own name) · src/ui prose & chrome pending later milestones (anatomy,
docs-*, content, hud, panel, controls, search, tour, trace-copy, help,
context-menu, control-center*, zoom-context, walk-up, world-handles,
mode-exits, trace-dwell) · walk mode (engine/walk, hands, swimming tests) ·
observability/ · machine/ · public/* assets (elephant mark) · analytics ·
corrections/catalog/replication core modules · package-lock.json

## Re-sync procedure (engine/ and tools/ only; optional)
```
git clone https://github.com/NikolayS/PGSimCity.git /tmp/pgsc && cd /tmp/pgsc
git diff 6d2c8543756538217d7a345c174a9e0cf85f5cad..origin/main -- src/engine tools
# port relevant hunks by hand; update the pin above; never add a remote
```
