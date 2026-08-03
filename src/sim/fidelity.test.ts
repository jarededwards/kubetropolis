/* Regression suite for the M1 fidelity review (k8s-controller-reviewer).
 * Each test reproduces a reviewer measurement (B-findings were BLOCKING:
 * the sim taught something false). Real-Kubernetes citations live in the
 * review report and in FIDELITY.md; claim values in core/claims. */

import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import { createFrameTimebase, MODEL_STEP_SECONDS } from '../core/timebase'
import type { DeploymentObj, NodeObj, PodObj, SimApi } from '../core/types'
import { samples } from './model'
import { mkSim, podNamed, pods, step, stepUntil } from './test-support'

function deployment(s: ReturnType<typeof mkSim>): DeploymentObj {
  for (const o of s.state.etcd.objects.values()) {
    if (o.kind === 'Deployment') return o
  }
  throw new Error('no deployment')
}

function nodeByName(s: ReturnType<typeof mkSim>, name: string): NodeObj {
  for (const o of s.state.etcd.objects.values()) {
    if (o.kind === 'Node' && o.name === name) return o
  }
  throw new Error(`no node ${name}`)
}

describe('B1 — preStop runs INSIDE the grace period', () => {
  it('killAt is deletionTimestamp + tgps, not + preStop + tgps', () => {
    const sim = mkSim({ preStopSleepSec: 20 })
    sim.apply(samples.pod('hooked'))
    stepUntil(sim, (s) => podNamed(s, 'hooked')?.status.phase === 'Running', 2400, 'running')
    sim.apply(samples.deletePod('hooked'))
    stepUntil(
      sim,
      (s) => podNamed(s, 'hooked')?.status.container.state === 'terminating',
      600,
      'terminating',
    )
    const pod = podNamed(sim.state, 'hooked')!
    const node = sim.state.nodes.find((n) => n.id === pod.spec.nodeName)!
    const rt = node.kubelet.runtime.get(pod.uid)!
    const t0 = pod.deletionTimestamp!
    // preStop delays SIGTERM but never extends the countdown.
    expect(rt.sigtermAt! - t0).toBeCloseTo(20, 1)
    expect(rt.killAt! - t0).toBeCloseTo(pod.spec.tgps, 1)
  })

  it('a preStop still running at expiry earns exactly one 2s extension', () => {
    const sim = mkSim({ preStopSleepSec: 45 }) // > tgps 30
    sim.apply(samples.pod('slowhook'))
    stepUntil(sim, (s) => podNamed(s, 'slowhook')?.status.phase === 'Running', 2400, 'running')
    sim.apply(samples.deletePod('slowhook'))
    stepUntil(
      sim,
      (s) => podNamed(s, 'slowhook')?.status.container.state === 'terminating',
      600,
      'terminating',
    )
    const pod = podNamed(sim.state, 'slowhook')!
    const node = sim.state.nodes.find((n) => n.id === pod.spec.nodeName)!
    const rt = node.kubelet.runtime.get(pod.uid)!
    const t0 = pod.deletionTimestamp!
    expect(rt.killAt! - t0).toBeCloseTo(pod.spec.tgps + 2, 1)
  })
})

describe('B2 — generation bumps on any spec change; scaling still opens no new contract', () => {
  it('scale bumps metadata.generation and observedGeneration follows', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'ready')
    const gen0 = deployment(sim).generation
    sim.apply(samples.scale(4))
    stepUntil(sim, (s) => s.vitals.podsReady === 4, 2400, 'scaled up')
    const dep = deployment(sim)
    expect(dep.generation).toBeGreaterThan(gen0)
    stepUntil(sim, (s) => {
      void s
      return deployment(sim).status.observedGeneration === dep.generation
    }, 1200, 'observedGeneration caught up')
    // Same pod template ⇒ same hash ⇒ still exactly one ReplicaSet.
    let rsCount = 0
    for (const o of sim.state.etcd.objects.values()) if (o.kind === 'ReplicaSet') rsCount += 1
    expect(rsCount).toBe(1)
  })

  it('a status-only write never bumps generation', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'ready')
    const gen = deployment(sim).generation
    step(sim, 600) // plenty of status churn settles through
    expect(deployment(sim).generation).toBe(gen)
  })
})

describe('B3/B3b — NotReady nodes are tainted and filtered', () => {
  it('the scheduler never binds to a node whose lease went silent', () => {
    const sim = mkSim({ nodeCount: 2 })
    stepUntil(sim, (s) => s.vitals.nodesReady === 2, 900, 'both ready')
    sim.setKnob('chaosNodeFail', 'node-b')
    stepUntil(sim, (s) => s.vitals.nodesReady === 1, 3600, 'node-b NotReady')
    expect(nodeByName(sim, 'node-b').spec.taints.some(
      (t) => t.key === 'node.kubernetes.io/unreachable' && t.effect === 'NoSchedule',
    )).toBe(true)

    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 3600, 'all placed')
    for (const p of pods(sim.state)) {
      expect(p.spec.nodeName).toBe('node-a')
    }
  })

  it('default NoExecute tolerations do not tolerate the NoSchedule taint', () => {
    const sim = mkSim({ nodeCount: 1 })
    stepUntil(sim, (s) => s.vitals.nodesReady === 1, 900, 'ready')
    sim.setKnob('chaosNodeFail', 'node-a')
    stepUntil(sim, (s) => s.vitals.nodesReady === 0, 3600, 'dead')
    sim.apply(samples.pod('stranded'))
    // Only node is tainted NoSchedule: the pod must stay Pending, unbound.
    step(sim, 900)
    const pod = podNamed(sim.state, 'stranded')!
    expect(pod.spec.nodeName).toBeUndefined()
    expect(sim.state.events.some((e) => e.reason === 'FailedScheduling')).toBe(true)
  })
})

describe('B10 — pods on a dead node lose Ready', () => {
  it('node NotReady marks its pods unready through the API', () => {
    const sim = mkSim({ nodeCount: 2 })
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'steady')
    const victims = pods(sim.state).filter((p) => p.spec.nodeName === 'node-b')
    if (victims.length === 0) return // spread put nothing there — rerun-proof guard
    sim.setKnob('chaosNodeFail', 'node-b')
    stepUntil(sim, (s) => s.vitals.nodesReady === 1, 3600, 'NotReady')
    stepUntil(
      sim,
      (s) => pods(s).filter((p) => p.spec.nodeName === 'node-b').every((p) => !p.status.ready),
      600,
      'pods marked unready',
    )
  })
})

describe('B4 — scoring counts assumed pods: bursts spread', () => {
  it('six bare pods land two per node, not six on node-a', () => {
    const sim = mkSim()
    for (let i = 0; i < 6; i++) sim.apply(samples.pod(`burst-${i}`))
    stepUntil(sim, (s) => s.vitals.podsRunning === 6, 3600, 'all running')
    const perNode = new Map<string, number>()
    for (const p of pods(sim.state)) {
      perNode.set(p.spec.nodeName!, (perNode.get(p.spec.nodeName!) ?? 0) + 1)
    }
    expect([...perNode.values()].sort()).toEqual([2, 2, 2])
  })
})

describe('B5 — the vault commits in submission order', () => {
  it('a later write with a faster fsync never overtakes an earlier one', () => {
    const sim = mkSim()
    sim.setKnob('chaosEtcdSlow', true)
    sim.apply(samples.pod('alpha'))
    step(sim, 5) // alpha reaches the vault under the 500ms fsync
    sim.setKnob('chaosEtcdSlow', false)
    sim.apply(samples.pod('bravo'))
    stepUntil(sim, (s) => s.vitals.podsTotal === 2, 900, 'both committed')
    const podAdds = sim.state.etcd.log.filter((r) => r.kind === 'Pod' && r.event === 'ADDED')
    const names = podAdds.map((r) => (sim.state.etcd.objects.get(r.uid) as PodObj).name)
    expect(names).toEqual(['alpha', 'bravo'])
  })
})

describe('B7 — a second delete is a no-op on a terminating pod', () => {
  it('pressing delete twice does not force-kill', () => {
    const sim = mkSim({ preStopSleepSec: 10 })
    sim.apply(samples.pod('twice'))
    stepUntil(sim, (s) => podNamed(s, 'twice')?.status.phase === 'Running', 2400, 'running')
    sim.apply(samples.deletePod('twice'))
    stepUntil(
      sim,
      (s) => podNamed(s, 'twice')?.status.container.state === 'terminating',
      600,
      'terminating',
    )
    const t0 = podNamed(sim.state, 'twice')!.deletionTimestamp!
    sim.apply(samples.deletePod('twice')) // the impatient second press
    step(sim, 90) // 3 model-seconds — far less than preStop(10)+clean-exit
    expect(podNamed(sim.state, 'twice')).toBeDefined()
    // …and the kubelet still files the final paperwork on the honest clock.
    stepUntil(sim, (s) => podNamed(s, 'twice') === undefined, 1200, 'graceful removal')
    const removedAt = sim.state.now
    expect(removedAt - t0).toBeGreaterThanOrEqual(10) // preStop ran in full
    expect(sim.state.events.filter((e) => e.reason === 'Removed').length).toBe(1)
  })
})

describe('B6 — a leaked expectation cannot stall a desk forever', () => {
  it('expectations expire and the resync heals the count', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(3))
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 2400, 'steady')
    const rsUid = [...sim.state.etcd.objects.values()].find((o) => o.kind === 'ReplicaSet')!.uid
    // Simulate the reviewer's race: a create expectation whose pod will never
    // appear (hard-deleted before the desk's next read frame).
    const ctl = sim.state.controllers.replicaset
    const expect0 = ctl.expect.get(rsUid) ?? { creates: [], deletes: [], expiresAt: 0 }
    expect0.creates = ['u-never']
    expect0.expiresAt = sim.state.now + CLAIM_VALUES.controllerExpectations.ttlSeconds
    ctl.expect.set(rsUid, expect0)

    sim.apply(samples.deletePod(pods(sim.state)[0].name))
    // Phantom create masks the loss at first…
    step(sim, 300)
    expect(sim.state.vitals.podsReady).toBeLessThan(3)
    // …but TTL + resync always converge back to N.
    stepUntil(sim, (s) => s.vitals.podsReady === 3, 12000, 'healed after TTL')
  })
})

describe('A2 — model behavior is invariant under timeScale', () => {
  it('the same script reaches byte-identical state at 1x and 4x', () => {
    const run = (timeScale: number): unknown => {
      const sim: SimApi = mkSim()
      sim.apply(samples.deployment(3))
      const tb = createFrameTimebase((dt) => sim.update(dt))
      // Drive with 0.5s wall frames until exactly 120 model-seconds elapsed.
      while (sim.state.now < 120 - 1e-9) {
        tb.advance(0.5, false, timeScale)
      }
      expect(sim.state.now).toBeCloseTo(120, 6)
      return sim.toSnapshot()
    }
    const slow = run(1)
    const fast = run(4)
    expect(JSON.stringify(fast)).toBe(JSON.stringify(slow))
  })

  it('every step the model ever sees is exactly MODEL_STEP_SECONDS', () => {
    const seen = new Set<number>()
    const tb = createFrameTimebase((dt) => {
      seen.add(dt)
    })
    tb.advance(0.4, false, 0.05)
    tb.advance(0.4, false, 1)
    tb.advance(0.4, false, 4)
    expect([...seen]).toEqual([MODEL_STEP_SECONDS])
  })
})

describe('A3 — couriers walk distinct roads', () => {
  it('two subscribers observe the same commit at different model times', () => {
    const sim = mkSim()
    sim.apply(samples.pod('skewed'))
    stepUntil(sim, (s) => s.api.watchers.some((w) => w.backlog.length > 0), 60, 'fanned out')
    const podWatchers = sim.state.api.watchers.filter((w) => w.backlog.length > 0)
    expect(podWatchers.length).toBeGreaterThan(1)
    const arrivals = new Set(podWatchers.map((w) => w.backlog[0].visibleAt))
    expect(arrivals.size).toBeGreaterThan(1)
    // …and nobody is FASTER than the base courier pace.
    for (const w of sim.state.api.watchers) {
      expect(w.latencyFactor).toBeGreaterThanOrEqual(1)
    }
  })
})
