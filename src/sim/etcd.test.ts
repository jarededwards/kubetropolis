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
    // sched + ctl.replicaset + one kubelet per node
    expect(podWatchers.length).toBe(2 + sim.state.nodes.length)
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

  it('compaction trims the log and flags only genuinely lagging watchers', () => {
    const sim = mkSim()
    sim.apply(samples.deployment(2))
    stepUntil(sim, (s) => s.vitals.podsReady === 2, 2400, 'steady state')
    // run past the 300 model-second compaction sweep
    stepUntil(sim, (s) => s.etcd.compactedRevision > 0, 9200, 'compaction')
    expect(sim.state.etcd.log.length).toBe(0)
    // Healthy watchers drained long ago — nobody should be forced to relist.
    expect(sim.state.api.watchers.every((w) => !w.needsRelist)).toBe(true)
  })
})
