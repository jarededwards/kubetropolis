/* Kubetropolis sim — the EndpointSlice desk.
 *
 * The directory board is kept by a desk like any other: it watches pods and
 * services, recomputes which doors are open, and files the difference through
 * the permit hall. Ready ≡ serving ∧ ¬terminating (claims: slice.conditions);
 * a write is filed only on REAL change, so the slice's generation is the
 * honest count of directory editions.
 */

import type { EndpointEntry, PodObj, SimState, Uid } from '../../core/types'
import { submit } from '../apiserver'
import { clone, getService, getSlice, mkEndpointSlice, pushEvent } from '../objects'

export function reconcileEndpointSlice(state: SimState, _uid: Uid): void {
  const svc = getService(state)
  if (!svc) return

  // Desired doors: every pod matching the selector, with honest conditions.
  const desired: EndpointEntry[] = []
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod') continue
    const pod = o as PodObj
    if (!matches(svc.spec.selector, pod.labels)) continue
    if (!pod.spec.nodeName) continue
    const terminating = pod.deletionTimestamp !== undefined
    const serving = pod.status.ready
    desired.push({
      podUid: pod.uid,
      podName: pod.name,
      nodeName: pod.spec.nodeName,
      conditions: { ready: serving && !terminating, serving, terminating },
    })
  }
  // Deterministic order: by pod name.
  desired.sort((a, b) => (a.podName < b.podName ? -1 : a.podName > b.podName ? 1 : 0))

  const slice = getSlice(state)
  if (!slice) {
    const fresh = mkEndpointSlice(state, svc)
    fresh.spec.endpoints = desired
    submit(state, 'create', fresh, 'ctl.endpointslice')
    pushEvent(state, 'Normal', 'SliceCreated', svc.name, `directory opened with ${desired.length} doors`)
    return
  }

  if (sameEndpoints(slice.spec.endpoints, desired)) return
  const next = clone(slice)
  next.spec = { serviceUid: slice.spec.serviceUid, endpoints: desired }
  submit(state, 'update', next, 'ctl.endpointslice')
  const ready = desired.filter((e) => e.conditions.ready).length
  pushEvent(state, 'Normal', 'SliceUpdated', svc.name, `directory edition filed — ${ready} ready of ${desired.length}`)
}

function matches(selector: Record<string, string>, labels: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(selector)) if (labels[k] !== v) return false
  return Object.keys(selector).length > 0
}

function sameEndpoints(a: EndpointEntry[], b: EndpointEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.podUid !== y.podUid
      || x.nodeName !== y.nodeName
      || x.conditions.ready !== y.conditions.ready
      || x.conditions.serving !== y.conditions.serving
      || x.conditions.terminating !== y.conditions.terminating
    ) {
      return false
    }
  }
  return true
}
