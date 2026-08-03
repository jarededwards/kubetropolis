/* The flagship trace — deterministic scripted runs.
 *
 * These tests drive the sim exactly the way the UI does (startTrace,
 * traceNext, endTrace) and assert the narrated stop sequence, the captured
 * counters at each boundary, and the knob snapshot/restore contract.
 */

import { describe, expect, it } from 'vitest'

import { createBus } from '../core/bus'
import { traceStopBit } from '../core/model-helpers'
import { presentedStages } from '../core/trace-presentation'
import type { SimApi, TraceStop } from '../core/types'
import { createSim } from './model'

const DT = 1 / 30

function mkSim(): SimApi {
  return createSim(createBus())
}

function run(sim: SimApi, seconds: number): void {
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) sim.update(DT)
}

/** Step-mode driver: press next, run until the sim auto-pauses again. */
function stepToNextStop(sim: SimApi, maxSeconds = 120): TraceStop {
  sim.traceNext()
  const steps = Math.round(maxSeconds / DT)
  for (let i = 0; i < steps; i++) {
    if (sim.state.trace?.autoPaused) break
    if (sim.state.knobs.paused) break
    sim.update(DT)
  }
  expect(sim.state.trace, 'trace vanished while stepping').not.toBeNull()
  return sim.state.trace!.stop
}

function stopSequence(sim: SimApi, action: 'apply-pod' | 'apply-deployment'): TraceStop[] {
  sim.startTrace(action, 'step')
  const seen: TraceStop[] = [sim.state.trace!.stop]
  const rail = presentedStages(action)
  for (let i = 0; i < rail.length + 2 && sim.state.trace!.stop !== 'done'; i++) {
    seen.push(stepToNextStop(sim))
  }
  return seen
}

describe('flagship trace — apply-pod', () => {
  it('walks the twelve stops in rail order', () => {
    const sim = mkSim()
    const seq = stopSequence(sim, 'apply-pod')
    expect(seq).toEqual(presentedStages('apply-pod').map((s) => s.stop))
  })

  it('captures the admission receipt, the commit revision, and the verdicts', () => {
    const sim = mkSim()
    sim.startTrace('apply-pod', 'step')

    stepToNextStop(sim) // admission
    const atAdmission = sim.state.trace!
    expect(atAdmission.mutations.length).toBeGreaterThanOrEqual(3)
    expect(atAdmission.mutations.join(' ')).toContain('probes defaulted')
    expect(atAdmission.mutations.join(' ')).toContain('tolerations injected')

    stepToNextStop(sim) // etcd_commit
    expect(sim.state.trace!.commitRev).toBeGreaterThan(0)
    expect(sim.state.trace!.trips).toBe(1)

    stepToNextStop(sim) // watch_fanout
    expect(sim.state.trace!.watchersTotal).toBeGreaterThan(0)

    stepToNextStop(sim) // sched_queue
    stepToNextStop(sim) // filter_score
    const t = sim.state.trace!
    expect(t.score, 'map-table verdicts captured').toBeDefined()
    expect(t.filter!.length).toBe(3)
    expect(t.chosen).toMatch(/^node-/)

    stepToNextStop(sim) // bind — the second trip through the hall
    expect(sim.state.trace!.trips).toBeGreaterThanOrEqual(2)
  })

  it('reaches Running with the pull counters filled and no Service listed', () => {
    const sim = mkSim()
    sim.startTrace('apply-pod', 'step')
    let stop: TraceStop = 'client'
    for (let i = 0; i < 16 && stop !== 'done'; i++) stop = stepToNextStop(sim)
    const t = sim.state.trace!
    expect(stop).toBe('done')
    expect(t.pullSeen).toBe(true)
    expect(t.pullTotalMB).toBeGreaterThan(0)
    expect(t.layersTotal).toBeGreaterThan(0)
    expect(t.serviceListed).toBe(false)
    expect(t.trips).toBeGreaterThanOrEqual(3) // create, bind, status writes
  })

  it('snapshots knobs on arm and restores them on close', () => {
    const sim = mkSim()
    const before = { ...sim.state.knobs }
    sim.startTrace('apply-pod', 'slow')
    expect(sim.state.knobs.timeScale).toBeCloseTo(0.05)
    run(sim, 5)
    sim.endTrace()
    expect(sim.state.trace).toBeNull()
    expect(sim.state.knobs).toEqual(before)
  })

  it('slow playback visits the same stops as live', () => {
    const live = mkSim()
    live.startTrace('apply-pod', 'live')
    run(live, 60)
    const slow = mkSim()
    slow.startTrace('apply-pod', 'slow')
    // 60 model seconds regardless of pace: the timebase scales wall time,
    // update(dt) here IS model time — playback must not change the journey.
    run(slow, 60)
    expect(slow.state.trace!.visited).toBe(live.state.trace!.visited)
    expect(slow.state.trace!.stop).toBe(live.state.trace!.stop)
  })

  it('step mode is deterministic: two fresh runs pause at identical stops', () => {
    const a = mkSim()
    const b = mkSim()
    const seqA = stopSequence(a, 'apply-pod')
    const seqB = stopSequence(b, 'apply-pod')
    expect(seqA).toEqual(seqB)
    expect(JSON.stringify(a.toSnapshot())).toBe(JSON.stringify(b.toSnapshot()))
  })
})

describe('flagship trace — apply-deployment variant', () => {
  it('inserts the two desk stops and counts controller trips before concrete', () => {
    const sim = mkSim()
    sim.startTrace('apply-deployment', 'step')
    const seen: TraceStop[] = [sim.state.trace!.stop]
    while (seen[seen.length - 1] !== 'rs_reconcile' && seen.length < 8) {
      seen.push(stepToNextStop(sim))
    }
    expect(seen).toEqual([
      'client',
      'admission',
      'etcd_commit',
      'watch_fanout',
      'deploy_reconcile',
      'rs_reconcile',
    ])
    const t = sim.state.trace!
    expect(t.rsCreated).toBe(true)
    // one paper filed, more papers already committed: dep + RS + ≥1 pod
    expect(t.trips).toBeGreaterThanOrEqual(3)
    expect(t.desiredReplicas).toBe(3)
  })

  it('follows the first family pod to done with a sibling ticker', () => {
    const sim = mkSim()
    sim.startTrace('apply-deployment', 'live')
    run(sim, 90)
    const t = sim.state.trace!
    expect(t.stop).toBe('done')
    expect(t.familyPods).toBe(3)
    expect(t.siblingsAtStop).toBe(2)
    expect(t.podName).toMatch(/^shopfront-/)
  })

  it('visited bitmask includes the desk stops for the deployment rail only', () => {
    const sim = mkSim()
    sim.startTrace('apply-deployment', 'live')
    run(sim, 90)
    expect(sim.state.trace!.visited & traceStopBit('deploy_reconcile')).not.toBe(0)

    const pod = mkSim()
    pod.startTrace('apply-pod', 'live')
    run(pod, 90)
    expect(pod.state.trace!.visited & traceStopBit('deploy_reconcile')).toBe(0)
  })
})

describe('flow emissions', () => {
  it('emits the honest hops for one traced apply', () => {
    const bus = createBus()
    const counts = new Map<string, number>()
    bus.on('flow', (req) => {
      counts.set(req.kind ?? '?', (counts.get(req.kind ?? '?') ?? 0) + 1)
    })
    const sim = createSim(bus)
    sim.apply({ kind: 'ApplyPod', name: 'web', image: 'harbor.city/shopfront:v1' })
    for (let i = 0; i < Math.round(40 / DT); i++) sim.update(DT)

    expect(counts.get('apply')).toBe(1)
    expect(counts.get('commit')! ).toBeGreaterThan(0)
    expect(counts.get('watchCourier')!).toBeGreaterThan(0)
    expect(counts.get('bindWrite')).toBe(1)
    expect(counts.get('imagePull')).toBe(1)
    expect(counts.get('heartbeat')!).toBeGreaterThan(0)
    // the outbox is transient: nothing lingers in state between ticks
    expect(sim.state.flowOutbox.length).toBe(0)
  })
})

describe('layer cache arithmetic', () => {
  it('a same-repo cached image shares base layers and shrinks the pull', () => {
    const sim = mkSim()
    sim.apply({ kind: 'ApplyPod', name: 'web', image: 'harbor.city/shopfront:v1' })
    run(sim, 40)
    const nodeWithCache = sim.state.nodes.find((n) => n.imageCache.size > 0)!
    expect(nodeWithCache).toBeDefined()

    // force the second pod onto the same node by filling nothing — instead
    // just apply v2 pods until one lands on the cached district
    sim.apply({ kind: 'ApplyPod', name: 'web2', image: 'harbor.city/shopfront:v2' })
    sim.apply({ kind: 'ApplyPod', name: 'web3', image: 'harbor.city/shopfront:v2' })
    sim.apply({ kind: 'ApplyPod', name: 'web4', image: 'harbor.city/shopfront:v2' })
    let sawShared = false
    for (let i = 0; i < Math.round(30 / DT); i++) {
      sim.update(DT)
      for (const n of sim.state.nodes) {
        for (const p of n.pulls) {
          if (p.image.endsWith(':v2') && p.layersHit > 0) {
            sawShared = true
            expect(p.totalMB).toBeLessThan(sim.state.knobs.imageSizeMB)
          }
        }
      }
    }
    expect(sawShared).toBe(true)
  })
})
