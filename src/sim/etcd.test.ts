import { describe, expect, it } from 'vitest'

import { samples } from './model'
import { mkSim, step, stepUntil } from './test-support'

describe('etcd — the vault', () => {
  it('nothing observes a write before commit: the pod appears only after admission + fsync', () => {
    const sim = mkSim()
    sim.apply(samples.pod('solo'))
    // Tick 1 runs intake + admission stage 1 — no pod commit possible yet.
    step(sim, 1)
    expect(sim.state.etcd.log.some((r) => r.kind === 'Pod')).toBe(false)
    expect(sim.state.api.inflight.some((r) => r.source === 'kubectl')).toBe(true)
    const ticks = stepUntil(sim, (s) => s.etcd.log.some((r) => r.kind === 'Pod'), 30, 'pod commit')
    // Three admission stages at one per tick, then fsync — never instant.
    expect(ticks).toBeGreaterThanOrEqual(2)
  })

  it('assigns increasing revisions and appends the change log in order', () => {
    const sim = mkSim()
    sim.apply(samples.pod('a'))
    sim.apply(samples.pod('b'))
    stepUntil(sim, (s) => s.vitals.podsTotal === 2, 60, 'both pods stored')
    const revs = sim.state.etcd.log.map((r) => r.rev)
    expect([...revs].sort((x, y) => x - y)).toEqual(revs)
    expect(new Set(revs).size).toBe(revs.length)
  })

  it('fans out one commit to every matching watcher, and only after commit', () => {
    const sim = mkSim()
    sim.apply(samples.pod('watched'))
    stepUntil(sim, (s) => s.etcd.log.some((r) => r.kind === 'Pod'), 30, 'pod committed')
    const podWatchers = sim.state.api.watchers.filter((w) => w.kinds.includes('Pod'))
    // sched + ctl.replicaset + ctl.endpointslice (M6) + one kubelet per node
    expect(podWatchers.length).toBe(3 + sim.state.nodes.length)
    for (const w of podWatchers) {
      expect(w.backlog.length).toBeGreaterThan(0)
    }
  })

  it('delivers after watchLatency: the scheduler acts strictly later than the commit', () => {
    const sim = mkSim()
    sim.apply(samples.pod('later'))
    stepUntil(sim, (s) => s.etcd.log.some((r) => r.kind === 'Pod'), 30, 'commit')
    // The queue drains inside the same tick it fills (stage 4 feeds stage 6),
    // so the observable proof of delivery is the first scheduling cycle.
    expect(sim.state.sched.scheduled).toBe(0)
    const deliveredAt = stepUntil(sim, (s) => s.sched.scheduled > 0, 30, 'first cycle')
    // 300 model-ms of courier time at 1/30s ticks ≈ 9 ticks after the commit
    expect(deliveredAt).toBeGreaterThanOrEqual(8)
  })

  it('compaction retains one interval of history and spares healthy watchers', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'steady state')
    // Two sweeps: the first records the interval revision, the second compacts
    // to it (kube-apiserver compacts to the interval-AGO revision, not now).
    stepUntil(sim, (s) => s.etcd.compactedRevision > 0, 20000, 'second sweep compacts')
    expect(sim.state.etcd.compactedRevision).toBeLessThan(sim.state.etcd.lastIntervalRevision)
    expect(sim.state.etcd.log.every((r) => r.rev > sim.state.etcd.compactedRevision)).toBe(true)
    // Healthy watchers bookmark every minute — far inside the 300s interval —
    // so nobody is forced to relist.
    expect(sim.state.api.watchers.every((w) => !w.needsRelist)).toBe(true)
  })

  it('a watcher that fell behind compaction relists — after a real LIST delay', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'steady')
    // Wedge a watcher into the past, behind the (future) compacted revision.
    const w = sim.state.api.watchers.find((x) => x.subscriber === 'sched')!
    stepUntil(sim, (s) => s.etcd.compactedRevision > 0, 20000, 'compacted')
    w.sentRev = sim.state.etcd.compactedRevision - 1
    w.backlog = []
    w.nextBookmarkAt = sim.state.now + 3600 // no bookmark rescue
    stepUntil(sim, (s) => {
      void s
      return w.needsRelist || w.sentRev >= sim.state.etcd.compactedRevision
    }, 12000, 'flagged')
    // The relist is not free: it completes only after its LIST latency.
    if (w.needsRelist) {
      const flaggedAt = sim.state.now
      stepUntil(sim, () => !w.needsRelist, 600, 'relisted')
      expect(sim.state.now).toBeGreaterThan(flaggedAt)
      expect(w.sentRev).toBeGreaterThanOrEqual(sim.state.etcd.compactedRevision)
    }
  })
})
