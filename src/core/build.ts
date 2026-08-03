/* Derived from PGSimCity src/core/build.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: build-metadata define
 * names renamed to the __KUBETROPOLIS_*__ namespace. */
declare const __KUBETROPOLIS_VERSION__: string
declare const __KUBETROPOLIS_GIT_SHA__: string

export const BUILD_VERSION =
  typeof __KUBETROPOLIS_VERSION__ === 'string' ? __KUBETROPOLIS_VERSION__ : 'dev'
export const BUILD_SHA =
  typeof __KUBETROPOLIS_GIT_SHA__ === 'string' ? __KUBETROPOLIS_GIT_SHA__ : 'unknown'
export const BUILD_LABEL = `v${BUILD_VERSION} · ${BUILD_SHA}`
