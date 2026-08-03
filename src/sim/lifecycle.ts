/* Kubetropolis sim — M8 lifecycle machinery.
 *
 * Three closely-related civic processes live here:
 *  - policy ensure: the knobs that declare a budget/quota/autoscaler become
 *    real objects, applied through the permit hall like everything else;
 *  - the taint manager: NoExecute countdowns on pods bound to unreachable
 *    districts. NOT the Eviction API — budgets do not protect against node
 *    loss (claims: taint.eviction); after the countdown the row is removed in
 *    one NodeLost write (FIDELITY.md discloses the Terminating-limbo shortcut);
 *  - drains: kubectl drain is a CLIENT loop — cordon once, then evict
 *    pod-by-pod through the Eviction API, retrying 429s with backoff.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { NodeObj, PodObj, SimState } from '../core/types'
import { submit } from './apiserver'
import {
  QUOTA_LOW_PODS,
  clone,
  getHpa,
  getPdb,
  getQuota,
  mkHpa,
  mkPdb,
  mkQuota,
  pushEvent,
} from './objects'

const UNREACHABLE = 'node.kubernetes.io/unreachable'

/** letter suffix for flow routes; only a/b/c districts have drawn roads */
function routeLetter(node: string): string | null {
  const letter = node.slice('node-'.length)
  return letter === 'a' || letter === 'b' || letter === 'c' ? letter : null
}

/* ---------------------------------------------------------------------------
 * Policy ensure — dials become paperwork.
 * -------------------------------------------------------------------------*/

export function ensurePolicyObjects(state: SimState): void {
  const pendingKind = (kind: string): boolean =>
    state.api.inflight.some((r) => r.obj.kind === kind)
    || state.etcd.proposals.some((p) => p.req.obj.kind === kind)

  const k = state.knobs

  const pdb = getPdb(state)
  if (k.pdbEnabled && !pdb && !pendingKind('PodDisruptionBudget')) {
    submit(state, 'create', mkPdb(state, k.pdbMinAvailable), 'kubectl')
    pushEvent(state, 'Normal', 'Applied', 'shopfront-pdb', `disruption budget filed — keep ${k.pdbMinAvailable} open`)
  } else if (!k.pdbEnabled && pdb && !pendingKind('PodDisruptionBudget')) {
    submit(state, 'delete', clone(pdb), 'kubectl')
  } else if (pdb && pdb.spec.minAvailable !== k.pdbMinAvailable && !pendingKind('PodDisruptionBudget')) {
    const next = clone(pdb)
    next.spec.minAvailable = k.pdbMinAvailable
    submit(state, 'update', next, 'kubectl')
  }

  const quota = getQuota(state)
  if (k.chaosQuotaLow && !quota && !pendingKind('ResourceQuota')) {
    submit(state, 'create', mkQuota(state, QUOTA_LOW_PODS), 'kubectl')
    pushEvent(state, 'Normal', 'Applied', 'shops-quota', `the neighborhood caps pods at ${QUOTA_LOW_PODS}`)
  } else if (!k.chaosQuotaLow && quota && !pendingKind('ResourceQuota')) {
    submit(state, 'delete', clone(quota), 'kubectl')
    pushEvent(state, 'Normal', 'QuotaLifted', 'shops-quota', 'the cap is gone; the desk\'s next retry will clear')
  }

  const hpa = getHpa(state)
  if (k.hpaEnabled && !hpa && !pendingKind('HorizontalPodAutoscaler')) {
    submit(
      state,
      'create',
      mkHpa(state, {
        targetDeployment: 'shopfront',
        targetCpuPct: k.hpaTargetCpuPct,
        min: k.hpaMin,
        max: k.hpaMax,
      }),
      'kubectl',
    )
    pushEvent(state, 'Normal', 'Applied', 'shopfront-hpa', 'the autoscaler desk receives its charter')
  } else if (!k.hpaEnabled && hpa && !pendingKind('HorizontalPodAutoscaler')) {
    submit(state, 'delete', clone(hpa), 'kubectl')
  } else if (
    hpa
    && !pendingKind('HorizontalPodAutoscaler')
    && (hpa.spec.targetCpuPct !== k.hpaTargetCpuPct
      || hpa.spec.min !== k.hpaMin
      || hpa.spec.max !== k.hpaMax)
  ) {
    const next = clone(hpa)
    next.spec.targetCpuPct = k.hpaTargetCpuPct
    next.spec.min = k.hpaMin
    next.spec.max = k.hpaMax
    submit(state, 'update', next, 'kubectl')
  }
}

/* ---------------------------------------------------------------------------
 * The taint manager — the second clock.
 * -------------------------------------------------------------------------*/

export function stepTaintManager(state: SimState): void {
  // Districts currently carrying the unreachable NoExecute taint.
  const dead = new Set<string>()
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Node') continue
    const n = o as NodeObj
    if (n.spec.taints.some((t) => t.key === UNREACHABLE && t.effect === 'NoExecute')) dead.add(n.name)
  }

  // Expire or cancel armed countdowns. Expiry = armedAt + the LIVE dial.
  for (const [uid, armedAt] of [...state.evictions.entries()]) {
    const pod = state.etcd.objects.get(uid) as PodObj | undefined
    if (!pod || !pod.spec.nodeName || !dead.has(pod.spec.nodeName) || pod.deletionTimestamp !== undefined) {
      state.evictions.delete(uid)
      if (pod && pod.spec.nodeName && !dead.has(pod.spec.nodeName)) {
        pushEvent(state, 'Normal', 'EvictionCancelled', pod.name, 'the district came back before the countdown ran out')
      }
      continue
    }
    const pod0 = state.etcd.objects.get(uid) as PodObj | undefined
    const tolerated0 = pod0?.spec.tolerations.some(
      (t) => t.key === UNREACHABLE && t.effect === 'NoExecute',
    )
    if (state.now >= armedAt + (tolerated0 ? state.knobs.unreachableTolerationSec : 0)) {
      state.evictions.delete(uid)
      // One NodeLost write removes the row — no kubelet is alive to run the
      // grace dance, and no budget applies (claims: taint.eviction).
      submit(state, 'remove', clone(pod), 'ctl.nodelifecycle')
      pushEvent(
        state,
        'Warning',
        'NodeLost',
        pod.name,
        `toleration expired on unreachable ${pod.spec.nodeName} — pod removed; the contract rebuilds elsewhere`,
      )
      const letter = routeLetter(pod.spec.nodeName)
      if (letter) state.flowOutbox.push({ route: `evict.${letter}`, kind: 'evict' })
    }
  }

  // Arm countdowns for newly-stranded pods. The countdown length is the DIAL
  // (knobs.unreachableTolerationSec), not the stamped spec — a dial, not
  // history, so the self-heal chapter can shorten the wait on camera
  // (FIDELITY.md; the stamped 300s stays on the receipt).
  for (const o of state.etcd.objects.values()) {
    if (o.kind !== 'Pod') continue
    const pod = o as PodObj
    if (!pod.spec.nodeName || !dead.has(pod.spec.nodeName)) continue
    if (pod.deletionTimestamp !== undefined || state.evictions.has(pod.uid)) continue
    const tolerated = pod.spec.tolerations.some(
      (t) => t.key === UNREACHABLE && t.effect === 'NoExecute',
    )
    const seconds = tolerated ? state.knobs.unreachableTolerationSec : 0
    state.evictions.set(pod.uid, state.now)
    pushEvent(
      state,
      'Warning',
      'TaintEvictionArmed',
      pod.name,
      `unreachable NoExecute — eviction in ${seconds}s unless the district returns`,
    )
  }
}

/* ---------------------------------------------------------------------------
 * Drains — inspectors do not sulk.
 * -------------------------------------------------------------------------*/

export function stepDrains(state: SimState): void {
  for (const drain of state.drains) {
    if (drain.phase !== 'evicting') continue
    if (state.now < drain.nextAttemptAt) continue

    const remaining: PodObj[] = []
    for (const o of state.etcd.objects.values()) {
      if (o.kind !== 'Pod') continue
      const pod = o as PodObj
      if (pod.spec.nodeName === drain.node && pod.deletionTimestamp === undefined) remaining.push(pod)
    }
    if (remaining.length === 0) {
      drain.phase = 'done'
      pushEvent(state, 'Normal', 'NodeDrained', drain.node, 'every building left by eviction paperwork')
      continue
    }
    remaining.sort((a, b) => (a.name < b.name ? -1 : 1))
    const victim = remaining[0]
    submit(state, 'evict', clone(victim), `drain.${drain.node}`)
    // Optimistic pacing: one filing per model second; a 429 pushes this out
    // (apiserver.onEvictionBlocked) with doubling backoff.
    drain.nextAttemptAt = state.now + 1
  }
}

/** Called by admission when a budget refuses an eviction (HTTP 429 analog). */
export function onEvictionBlocked(state: SimState, pod: PodObj): void {
  state.counters.drainDenied += 1
  const drain = state.drains.find((d) => d.node === pod.spec.nodeName && d.phase === 'evicting')
  if (drain) {
    drain.denied += 1
    drain.backoffSec = Math.min(
      CLAIM_VALUES.disruption.modelRetryCapSeconds,
      Math.max(CLAIM_VALUES.disruption.modelRetryBaseSeconds, drain.backoffSec * 2),
    )
    drain.nextAttemptAt = state.now + drain.backoffSec
  }
  const letter = pod.spec.nodeName ? routeLetter(pod.spec.nodeName) : null
  if (letter) state.flowOutbox.push({ route: `evict.${letter}`, kind: 'evict' })
}
