# Kubetropolis

**An explorable 3D city that shows how Kubernetes actually works.**

City Hall is the API server. The Hall of Records vault beneath it is etcd —
the only source of truth. The Zoning Office schedules, the Office of
Inspectors reconciles forever, districts are nodes, buildings are pods, and
container images arrive as cargo through a working harbor. Everything you see
is driven by a real, deterministic in-browser model of the control plane: one
write to the ledger, watched by couriers, reconciled by desks. Nothing talks
to anything except through the API server.

**Status: pre-alpha (M0 — engine first light).** See ROADMAP.md for the
milestone ladder and FIDELITY.md for exactly where the model ends.

## Run it

```
npm install
npm run dev        # vite dev server on :5173
npm run preview    # serve the built site on :4173
npm run typecheck && npm test && npm run build
```

Requires WebGL2. Fully static; zero application network calls; three.js is
the only runtime dependency.

## Credits & provenance

Kubetropolis is inspired by — and vendors the rendering engine of —
[PGSimCity](https://github.com/NikolayS/PGSimCity) by Nikolay Samokhvalov
(Apache-2.0). The Kubernetes domain model, city design, and all teaching
content are original to this project. Per-file provenance: VENDORED.md.

## Legal

Kubetropolis is an independent, non-commercial educational project. It is not
affiliated with, sponsored by, or endorsed by The Linux Foundation or the
Cloud Native Computing Foundation. Kubernetes® is a registered trademark of
The Linux Foundation, used here only to refer to the technology itself; the
Kubernetes logo is not used. This project contains no SimCity code, assets,
artwork, logos, characters, audio, or game content. License: Apache-2.0 (see
LICENSE, NOTICE).
