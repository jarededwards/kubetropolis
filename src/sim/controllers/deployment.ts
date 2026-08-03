/* Kubetropolis sim — the Deployment desk.
 *
 * Ensures a ReplicaSet contract exists for the current template (identified
 * by pod-template-hash, which keeps sibling contracts disjoint) and keeps its
 * replica count in step. Scaling edits the contract WITHOUT bumping the
 * template generation — scaling is not a rollout. The multi-RS surge math
 * arrives at M4 with `set-image`.
 */

import type { DeploymentObj, ReplicaSetObj, SimState, Uid } from '../../core/types'
import { submit } from '../apiserver'
import { clone, getDeployment, mkReplicaSet, pushEvent, templateHash } from '../objects'

export function reconcileDeployment(state: SimState, uid: Uid): void {
  const dep = getDeployment(state, uid)
  if (!dep) return

  const ctl = state.controllers.deployment
  const hash = templateHash(dep.spec.template)
  const children = rsOwnedBy(state, dep.uid)
  const current = children.find((rs) => rs.spec.podTemplateHash === hash)

  if (!current) {
    const expect = ctl.expect.get(dep.uid) ?? { creates: [], deletes: [] }
    expect.creates = expect.creates.filter((rsUid) => !state.etcd.objects.has(rsUid))
    if (expect.creates.length === 0) {
      const rs = mkReplicaSet(state, dep, hash)
      expect.creates.push(rs.uid)
      ctl.expect.set(dep.uid, expect)
      submit(state, 'create', rs, 'ctl.deployment')
      pushEvent(state, 'Normal', 'ScalingReplicaSet', dep.name, `opened contract ${rs.name} for ${rs.spec.replicas}`)
    }
    return
  }
  ctl.expect.delete(dep.uid)

  if (current.spec.replicas !== dep.spec.replicas) {
    const next = clone(current)
    next.spec.replicas = dep.spec.replicas
    // replica count is not a template change: generation stays put
    submit(state, 'update', next, 'ctl.deployment')
    pushEvent(state, 'Normal', 'ScalingReplicaSet', dep.name, `contract ${current.name} → ${dep.spec.replicas}`)
  }

  syncStatus(state, dep, children)
}

function rsOwnedBy(state: SimState, depUid: Uid): ReplicaSetObj[] {
  const out: ReplicaSetObj[] = []
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'ReplicaSet' && o.ownerUid === depUid) out.push(o)
  }
  return out
}

function syncStatus(state: SimState, dep: DeploymentObj, children: ReplicaSetObj[]): void {
  let observed = 0
  let ready = 0
  for (const rs of children) {
    observed += rs.status.observed
    ready += rs.status.ready
  }
  if (dep.status.observed !== observed || dep.status.ready !== ready) {
    const next = clone(dep)
    next.status.observed = observed
    next.status.ready = ready
    next.status.updated = observed
    submit(state, 'updateStatus', next, 'ctl.deployment')
  }
}
