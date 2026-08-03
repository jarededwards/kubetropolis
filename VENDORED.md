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
types.ts **(A @M1: Kubernetes contract replaced the Postgres SimState/Knobs; TV-legacy block holds the constants/TableDef the TV world still needs until M2)** ·
bus.ts · registry.ts · timebase.ts(+test) **(A @M1.5, fidelity A2: timeScale
varies the NUMBER of fixed steps per frame, never the step size — model
behavior is invariant across playback speeds)** · theme.ts(+test) **(TV palette → M2 retint)** ·
themes.ts(+test) **(A: theme localStorage key renamed)** · util.ts(+test) ·
beveled-box.ts(+test) · build.ts **(A: define names)** ·
city-route.ts(+test) · claims.ts **(A @M1: rewritten — Kubernetes claims registry, mechanism inherited)** ·
catalog.ts **(TV → M2: Postgres table catalog, required by the TV layout.ts)** ·
destinations.ts(+test) · model-helpers.ts · route-ids.ts · trace-presentation.ts **(A @M1: K8s apply-journey stops)**

## src/spine — deleted at M1 (only the Postgres claims imported it)

## src/engine
renderer.ts(+test) **(A: district glow anchors → records.vault/harbor.crane)** ·
camera.ts(+camera-controls.test) **(A: imports ../world/plan; test's plaza
ceiling constant localized)** ·
collision.ts V **(collision.test.ts deleted: 513 lines driving the unvendored
walk controller — returns with walk mode if ever vendored)** ·
color-grade.ts(+test) V · flows.ts V-inert · label-detail.ts V-inert ·
label-layout.ts(+test) V-inert · labels.ts(+labels-occlusion.test) **(A: Kubetropolis district maps; wired)** ·
light-shafts.ts V(+test) · picker.ts(+test) **(A: district colors; wired)** ·
roads.ts V-inert (not wired at M0: the vendored street grid follows the TV
Postgres layout and would mislead on the island; wired at M2 with real routes) ·
water.ts **(A at M2: resized to the city plan's harbor sea rectangle; the
caller positions the group at the sea centre; Reflector visibility at low
quality is an M8 art-pass item)** ·
audio.ts **(A: storage key renamed; dependency of walk mode, never wired)**

## src/world
layout.ts **(rewritten at M2: the Kubetropolis geography — civic campus,
records pit, node districts, harbor, 16 routes; single-geography doctrine
kept)** ·
sky.ts(+test) **(A: elephant asterism replaced by the Beacon — lighthouse over
an anchor, western sky)** ·
ground.ts **(A: imports ./plan; Kubetropolis plinths/cones/decals; pit is the
records vault cut)** · ground-surface.ts(+test) V · plate-fog.ts V ·
**plan.ts / plan.test.ts (A: renamed copy of upstream src/world/slonik.ts —
generic ring math kept verbatim; the elephant outline path replaced with the
Kubetropolis island outline with western harbor bay)**

## src/ui
uikit.ts V · boot.ts(+test) **(A: 12-step Kubetropolis boot ladder)** ·
legal.ts **(A: rewritten — K8s notice replaces EA notice)** ·
touchpad.ts **(still out: imports the unvendored walk controller; the M2 HUD
shipped without it — mobile gesture pass lands at M8)** ·
**Original Kubetropolis files (not vendored): hud.ts, panel.ts, search.ts,
help.ts, debug-overlay.ts — written lean against uikit + the vendored CSS.**

## src/styles
All 12 CSS files V (retint via tokens at M2).

## test
dom.ts V · sim-boundary.test.ts V (entry src/sim/model.ts unchanged) ·
trademark-notice.test.ts **(A: K8s notice; help-overlay assertion returns M2)** ·
camera-floor.test.ts V · build-metadata.test.ts **(A: define names)** ·
cdp-profile.test.ts V · cdp-run.test.ts V

## tools
shoot.mjs **(A: env-overridable gate path + window.KUBETROPOLIS probe; M3:
Chrome auto-detected on macOS when CHROME_BIN unset)** ·
cdp-profile.mjs **(A: profile root renamed; profileIsInUse gains a `ps`
fallback for hosts without /proc — macOS)** ·
cdp-run.mjs V · reap.sh **(A: env-overridable gate path)** ·
reap-cdp-profiles.mjs V · bake-indirect.mjs **(A: gate path + probe)** ·
verify-hud-layout.mjs **(A at M2: rewritten lean on the upstream CDP harness —
viewport/vitals/one-panel/inspector/help invariants; upstream's fuller
label-budget instrument returns as the HUD grows)**

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
