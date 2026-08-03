/* Kubetropolis sim — the ReplicaSet desk.
 *
 * The desk holds a contract that says N, counts the street, and files the
 * difference as permits — it never visits the district and never touches
 * rubble. Expectations stop it re-filing the same permit while a previous
 * one is still crossing the permit hall (the standard controller trick).
 */

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

export function reconcileReplicaSet(state: SimState, uid: Uid): void {
  const rs = getReplicaSet(state, uid)
  if (!rs) return

  const ctl = state.controllers.replicaset
  const children = podsOwnedBy(state, rs.uid).filter((p) => !p.deletionTimestamp)
  const expect = ctl.expect.get(rs.uid) ?? { creates: 0, deletes: 0 }
  const effective = children.length + expect.creates - expect.deletes

  if (effective < rs.spec.replicas) {
    const missing = rs.spec.replicas - effective
    const batch = Math.min(missing, RS_CREATE_BATCH)
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
      submit(state, 'create', pod, 'ctl.replicaset')
    }
    ctl.expect.set(rs.uid, { creates: expect.creates + batch, deletes: expect.deletes })
    pushEvent(state, 'Normal', 'SuccessfulCreate', rs.name, `filed ${batch} pod permit(s), want ${rs.spec.replicas}`)
  } else if (effective > rs.spec.replicas) {
    // Victims: newest first by uid — a deterministic simplification of the
    // real ranking (unready-first, pod-deletion-cost); disclosed in FIDELITY.md.
    const surplus = effective - rs.spec.replicas
    const victims = [...children]
      .sort((a, b) => uidSeqOf(b.uid) - uidSeqOf(a.uid))
      .slice(0, surplus)
    for (const v of victims) submit(state, 'delete', clone(v), 'ctl.replicaset')
    ctl.expect.set(rs.uid, { creates: expect.creates, deletes: expect.deletes + victims.length })
    pushEvent(state, 'Normal', 'SuccessfulDelete', rs.name, `filed ${victims.length} demolition notice(s)`)
  }

  syncStatus(state, rs, children)
}

function syncStatus(state: SimState, rs: ReplicaSetObj, children: PodObj[]): void {
  const observed = children.length
  const ready = children.filter((p) => p.status.ready).length
  if (rs.status.observed !== observed || rs.status.ready !== ready) {
    const next = clone(rs)
    next.status.observed = observed
    next.status.ready = ready
    submit(state, 'update', next, 'ctl.replicaset')
  }
}
