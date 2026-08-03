# AGENTS.md — operating manual

Read CLAUDE.md first; it owns the architecture, determinism, truth, and
trademark rules. This file is the mechanics.

## Worktrees
- Agents work in `.claude/worktrees/<branch>/` inside the repo (vitest excludes
  `.claude/**` — do not remove that exclude).
- One branch per issue; Conventional Commits; never push; never `git stash`.
- Cross-cutting files (renderer.ts, main.ts, layout.ts, types.ts) get a
  dedicated worktree — never edit them alongside other work.
- Before commit: `git status --porcelain` and account for every line.

## Verification loop
```
npm run typecheck && npm test && npm run build
```
All three green before handoff. Visible changes additionally need a read
screenshot (below).

## Headless screenshots (tools/shoot.mjs)
- Software WebGL (SwiftShader) renders at 1–3 fps; allow 45–70 s settle.
- A two-slot directory semaphore gates concurrent browsers. Never raise
  CDP_MAX, never launch Chrome outside shoot.mjs — ten parallel rasterizers
  OOM-killed the reference project's box twice.
- Usage: `node tools/shoot.mjs <url> <out.png> <waitMs> <w> <h> [preJS]`
  with `CDP_PORT` in 9500–9900 per agent.
- Stage views through `window.KUBETROPOLIS` in preJS, e.g.
  `KUBETROPOLIS.bus.emit('focus',{id:'records.vault'})` — never poke internals.
- Screenshots are CI/scratch artifacts. NEVER commit PNGs to the repo.

## Dev server
`npm run dev` → http://localhost:5173 (vite, host mode). `npm run preview`
serves the built dist on 4173 — that is the deploy check while the project is
local-only.

## Debug overlay (M1+)
Backtick (`) toggles a read-only sim state overlay; `?debug=1` opens with it
on. Console demo: `KUBETROPOLIS.sim.apply(KUBETROPOLIS.samples.deployment())`,
then watch pods walk Pending → Running. Also `samples.pod()`,
`samples.scale(n)`, `samples.deletePod(name)`.
