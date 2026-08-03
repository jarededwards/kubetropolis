declare const __KUBETROPOLIS_VERSION__: string
declare const __KUBETROPOLIS_GIT_SHA__: string

export const BUILD_VERSION =
  typeof __KUBETROPOLIS_VERSION__ === 'string' ? __KUBETROPOLIS_VERSION__ : 'dev'
export const BUILD_SHA =
  typeof __KUBETROPOLIS_GIT_SHA__ === 'string' ? __KUBETROPOLIS_GIT_SHA__ : 'unknown'
export const BUILD_LABEL = `v${BUILD_VERSION} · ${BUILD_SHA}`
