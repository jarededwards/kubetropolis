/* Kubetropolis sim — the Deployment desk.
 *
 * One desk, two jobs. (1) Ensure a ReplicaSet contract exists for the CURRENT
 * template (pod-template-hash keeps sibling contracts disjoint) and keep its
 * count in step — scaling edits the contract without a new hash: no rollout.
 * (2) When the template changes, run the renovation: open the new contract and
 * pace the wave by maxSurge (rounds UP) / maxUnavailable (rounds DOWN), never
 * closing an old door until enough new doors are Ready (claims:
 * deploy.rollingDefaults, deploy.rolloutTrigger). Nothing renovates a
 * building; replacement is the only mechanism the city has.
 */

import { CLAIM_VALUES } from '../../core/claims'
import type { DeploymentObj, ReplicaSetObj, SimState, Uid } from '../../core/types'
import { submit } from '../apiserver'
import { clone, getDeployment, mkReplicaSet, podsOwnedBy, pushEvent, templateHash, uidSeqOf } from '../objects'

// The knob DEFAULTS derive from the claim registry (CLAIM_VALUES.rollingUpdate)
// via DEFAULT_KNOBS; per-object spec carries whatever the manifest declared.
export function pacing(dep: DeploymentObj): { surge: number; unavailable: number; clamped: boolean } {
  const desired = dep.spec.replicas
  let surge = Math.ceil((desired * dep.spec.maxSurgePct) / 100)
  const unavailable = Math.floor((desired * dep.spec.maxUnavailablePct) / 100)
  let clamped = false
  if (surge === 0 && unavailable === 0) {
    // Real validation rejects both-zero; the model clamps and says so.
    surge = 1
    clamped = true
  }
  return { surge, unavailable, clamped }
}

export function reconcileDeployment(state: SimState, uid: Uid): void {
  const dep = getDeployment(state, uid)
  if (!dep) return

  const ctl = state.controllers.deployment
  const hash = templateHash(dep.spec.template)
  const children = rsOwnedBy(state, dep.uid).sort((a, b) => uidSeqOf(a.uid) - uidSeqOf(b.uid))
  const current = children.find((rs) => rs.spec.podTemplateHash === hash)
  const olds = children.filter((rs) => rs.spec.podTemplateHash !== hash)
  const desired = dep.spec.replicas
  const { surge, unavailable, clamped } = pacing(dep)
  if (clamped && !state.events.some((e) => e.reason === 'InvalidPacing' && e.obj === dep.name)) {
    pushEvent(state, 'Warning', 'InvalidPacing', dep.name, 'maxSurge and maxUnavailable were both 0 — surge clamped to 1')
  }

  if (!current) {
    const expect = ctl.expect.get(dep.uid) ?? { creates: [], deletes: [], expiresAt: 0 }
    if (expect.expiresAt !== 0 && state.now > expect.expiresAt) {
      expect.creates = []
      expect.expiresAt = 0
    }
    expect.creates = expect.creates.filter((rsUid) => !state.etcd.objects.has(rsUid))
    if (expect.creates.length === 0) {
      // Fresh deployment: full count. Mid-renovation: only the surge headroom.
      const oldTotal = olds.reduce((n, rs) => n + rs.spec.replicas, 0)
      const initial = olds.length === 0 ? desired : Math.max(0, Math.min(desired, desired + surge - oldTotal))
      const rs = mkReplicaSet(state, dep, hash, initial)
      expect.creates.push(rs.uid)
      expect.expiresAt = state.now + CLAIM_VALUES.controllerExpectations.ttlSeconds
      ctl.expect.set(dep.uid, expect)
      submit(state, 'create', rs, 'ctl.deployment')
      pushEvent(
        state,
        'Normal',
        olds.length === 0 ? 'ScalingReplicaSet' : 'RolloutStarted',
        dep.name,
        olds.length === 0
          ? `opened contract ${rs.name} for ${initial}`
          : `renovation begins: new contract ${rs.name} opens at ${initial}`,
      )
    }
    return
  }
  ctl.expect.delete(dep.uid)

  const totalSpec = children.reduce((n, rs) => n + rs.spec.replicas, 0)
  // The availability gate reads the vault's pod truth in THIS frame (not the
  // lagged RS status): active = not terminating. Doors already scheduled to
  // close but not yet boarded up (active beyond spec) are counted against the
  // budget, or the desk would cut twice against one stale count.
  // Pending closes are PER-CONTRACT: an old contract's not-yet-boarded doors
  // cannot be masked by a new contract's not-yet-built pads.
  let readyActive = 0
  let pendingCloses = 0
  for (const rs of children) {
    let active = 0
    for (const p of podsOwnedBy(state, rs.uid)) {
      if (p.deletionTimestamp) continue
      active += 1
      if (p.status.ready) readyActive += 1
    }
    pendingCloses += Math.max(0, active - rs.spec.replicas)
  }

  // Scale the CURRENT contract: up within the surge envelope, down if desired shrank.
  if (current.spec.replicas < desired) {
    const room = desired + surge - totalSpec
    if (room > 0) {
      const target = Math.min(desired, current.spec.replicas + room)
      const next = clone(current)
      next.spec.replicas = target
      submit(state, 'update', next, 'ctl.deployment')
      pushEvent(state, 'Normal', 'ScalingReplicaSet', dep.name, `contract ${current.name} → ${target}`)
    }
  } else if (current.spec.replicas > desired) {
    const next = clone(current)
    next.spec.replicas = desired
    submit(state, 'update', next, 'ctl.deployment')
    pushEvent(state, 'Normal', 'ScalingReplicaSet', dep.name, `contract ${current.name} → ${desired}`)
  }

  // Retire the OLD contracts, newest grievance last: only as many doors as the
  // ready count can spare above the floor. This is the readiness gate.
  if (olds.length > 0) {
    const minAvailable = desired - unavailable
    let budget = readyActive - minAvailable - pendingCloses
    for (const old of olds) {
      if (budget <= 0) break
      if (old.spec.replicas === 0) continue
      const cut = Math.min(old.spec.replicas, budget)
      const next = clone(old)
      next.spec.replicas = old.spec.replicas - cut
      budget -= cut
      submit(state, 'update', next, 'ctl.deployment')
      pushEvent(state, 'Normal', 'ScalingReplicaSet', dep.name, `retiring ${old.name} → ${next.spec.replicas}`)
    }
  }

  syncStatus(state, dep, children, current, olds)
}

function rsOwnedBy(state: SimState, depUid: Uid): ReplicaSetObj[] {
  const out: ReplicaSetObj[] = []
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'ReplicaSet' && o.ownerUid === depUid) out.push(o)
  }
  return out
}

function syncStatus(
  state: SimState,
  dep: DeploymentObj,
  children: ReplicaSetObj[],
  current: ReplicaSetObj,
  olds: ReplicaSetObj[],
): void {
  let observed = 0
  let ready = 0
  for (const rs of children) {
    observed += rs.status.observed
    ready += rs.status.ready
  }
  // updatedReplicas counts ONLY the current-template contract (the real field's
  // meaning) — the M3 deployment rail narrates it climbing.
  const updated = current.status.observed
  if (
    dep.status.observed !== observed
    || dep.status.ready !== ready
    || dep.status.updated !== updated
    || dep.status.observedGeneration !== dep.generation
  ) {
    const wasComplete = deploymentComplete(dep.spec.replicas, dep.status.updated, dep.status.ready, olds)
    const next = clone(dep)
    next.status.observed = observed
    next.status.ready = ready
    next.status.updated = updated
    next.status.observedGeneration = dep.generation
    submit(state, 'updateStatus', next, 'ctl.deployment')
    const nowComplete = deploymentComplete(dep.spec.replicas, updated, ready, olds)
    if (nowComplete && !wasComplete && olds.length > 0) {
      pushEvent(state, 'Normal', 'RolloutComplete', dep.name, `all ${dep.spec.replicas} doors open on the new template`)
    }
  }
}

function deploymentComplete(desired: number, updated: number, ready: number, olds: ReplicaSetObj[]): boolean {
  return updated === desired && ready === desired && olds.every((rs) => rs.spec.replicas === 0)
}
