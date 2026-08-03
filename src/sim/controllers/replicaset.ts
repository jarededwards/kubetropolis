/* Kubetropolis sim — the ReplicaSet desk.
 *
 * The desk holds a contract that says N, counts the street, and files the
 * difference as permits — it never visits the district and never touches
 * rubble. Expectations stop it re-filing the same permit while a previous
 * one is still crossing the permit hall (the standard controller trick).
 */

import { CLAIM_VALUES } from '../../core/claims'
import type { PodObj, ReplicaSetObj, SimState, Uid } from '../../core/types'
import { submit } from '../apiserver'
import {
  clone,
  getReplicaSet,
  mkPod,
  nameSuffix,
  podsOwnedBy,
  pushEvent,
  RS_CREATE_BATCH,
  uidSeqOf,
} from '../objects'

const EXPECT_TTL = CLAIM_VALUES.controllerExpectations.ttlSeconds

export function reconcileReplicaSet(state: SimState, uid: Uid): void {
  const rs = getReplicaSet(state, uid)
  if (!rs) return

  const ctl = state.controllers.replicaset
  const children = podsOwnedBy(state, rs.uid).filter((p) => !p.deletionTimestamp)

  // Prune expectations against THIS read frame: a pending create settles the
  // moment the child is visible here; a pending delete settles the moment the
  // victim is terminating or gone. One frame — counts can never double.
  // B6: and the whole record EXPIRES on the ExpectationsTimeout — a create
  // whose pod was hard-deleted before this desk's next read frame must never
  // stall convergence forever (the failure mode is permanent UNDER-counting).
  const expect = ctl.expect.get(rs.uid) ?? { creates: [], deletes: [], expiresAt: 0 }
  if (expect.expiresAt !== 0 && state.now > expect.expiresAt) {
    expect.creates = []
    expect.deletes = []
    expect.expiresAt = 0
    pushEvent(state, 'Warning', 'ExpectationsExpired', rs.name, 'stale in-flight expectations dropped')
  }
  expect.creates = expect.creates.filter((podUid) => !state.etcd.objects.has(podUid))
  expect.deletes = expect.deletes.filter((podUid) => {
    const pod = state.etcd.objects.get(podUid)
    return pod !== undefined && pod.deletionTimestamp === undefined
  })
  const effective = children.length + expect.creates.length - expect.deletes.length

  if (effective < rs.spec.replicas) {
    const missing = rs.spec.replicas - effective
    const batch = Math.min(missing, RS_CREATE_BATCH)
    if (batch > 0) expect.expiresAt = state.now + EXPECT_TTL
    for (let i = 0; i < batch; i++) {
      const pod = mkPod(
        state,
        `${rs.name}-${nameSuffix(state)}`,
        {
          image: rs.spec.template.image,
          requests: rs.spec.template.requests,
          limitMemMi: rs.spec.template.limitMemMi,
        },
        rs.uid,
        { ...rs.labels },
      )
      state.podOwners.set(pod.uid, rs.uid)
      expect.creates.push(pod.uid)
      submit(state, 'create', pod, 'ctl.replicaset')
    }
    pushEvent(state, 'Normal', 'SuccessfulCreate', rs.name, `filed ${batch} pod permit(s), want ${rs.spec.replicas}`)
  } else if (effective > rs.spec.replicas) {
    // Victims: newest first by uid — a deterministic simplification of the
    // real ranking (unready-first, pod-deletion-cost); disclosed in FIDELITY.md.
    const surplus = effective - rs.spec.replicas
    const victims = [...children]
      .filter((p) => !expect.deletes.includes(p.uid))
      .sort((a, b) => uidSeqOf(b.uid) - uidSeqOf(a.uid))
      .slice(0, surplus)
    if (victims.length > 0) expect.expiresAt = state.now + EXPECT_TTL
    for (const v of victims) {
      expect.deletes.push(v.uid)
      submit(state, 'delete', clone(v), 'ctl.replicaset')
    }
    if (victims.length > 0) {
      pushEvent(state, 'Normal', 'SuccessfulDelete', rs.name, `filed ${victims.length} demolition notice(s)`)
    }
  }

  if (expect.creates.length === 0 && expect.deletes.length === 0) ctl.expect.delete(rs.uid)
  else ctl.expect.set(rs.uid, expect)

  syncStatus(state, rs, children)
}

function syncStatus(state: SimState, rs: ReplicaSetObj, children: PodObj[]): void {
  const observed = children.length
  const ready = children.filter((p) => p.status.ready).length
  if (rs.status.observed !== observed || rs.status.ready !== ready) {
    const next = clone(rs)
    next.status.observed = observed
    next.status.ready = ready
    submit(state, 'updateStatus', next, 'ctl.replicaset')
  }
}
