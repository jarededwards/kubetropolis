import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import type { LeaseObj, NodeObj } from '../core/types'
import { mkSim, stepUntil } from './test-support'

function lease(sim: ReturnType<typeof mkSim>, name: string): LeaseObj {
  for (const o of sim.state.etcd.objects.values()) {
    if (o.kind === 'Lease' && o.name === name) return o
  }
  throw new Error(`no lease for ${name}`)
}

function nodeObj(sim: ReturnType<typeof mkSim>, name: string): NodeObj {
  for (const o of sim.state.etcd.objects.values()) {
    if (o.kind === 'Node' && o.name === name) return o
  }
  throw new Error(`no node ${name}`)
}

describe('nodes — heartbeats and the lifecycle desk', () => {
  it('foremen renew their leases on the heartbeat period, through the API', () => {
    const sim = mkSim({ nodeCount: 1 })
    stepUntil(sim, (s) => {
      void s
      return lease(sim, 'node-a').spec.renewedAt > 0
    }, 900, 'first renewal')
    const t1 = lease(sim, 'node-a').spec.renewedAt
    stepUntil(sim, () => lease(sim, 'node-a').spec.renewedAt > t1, 900, 'second renewal')
    const t2 = lease(sim, 'node-a').spec.renewedAt
    expect(t2 - t1).toBeCloseTo(CLAIM_VALUES.kubeletHeartbeat.statusUpdateSeconds, 0)
  })

  it('how long nothing happens: silence → NotReady only after the 50s grace', () => {
    const sim = mkSim({ nodeCount: 2 })
    stepUntil(sim, () => lease(sim, 'node-b').spec.renewedAt > 0, 900, 'heartbeats up')
    sim.setKnob('chaosNodeFail', 'node-b')
    const cutAt = sim.state.now

    stepUntil(sim, () => !nodeObj(sim, 'node-b').status.conditions[0].status, 3600, 'NotReady')
    const notReadyAt = sim.state.now
    // Never earlier than the grace period; monitor period + heartbeat staleness add slack.
    expect(notReadyAt - cutAt).toBeGreaterThanOrEqual(CLAIM_VALUES.nodeMonitor.graceSeconds - 1)
    expect(sim.state.events.some((e) => e.reason === 'NodeNotReady')).toBe(true)
    // The other district keeps its heartbeat and its Ready condition.
    expect(nodeObj(sim, 'node-a').status.conditions[0].status).toBe(true)
  })

  it('power restored: heartbeats resume and the desk flips Ready back', () => {
    const sim = mkSim({ nodeCount: 1 })
    stepUntil(sim, () => lease(sim, 'node-a').spec.renewedAt > 0, 900, 'up')
    sim.setKnob('chaosNodeFail', 'node-a')
    stepUntil(sim, () => !nodeObj(sim, 'node-a').status.conditions[0].status, 3600, 'down')
    sim.setKnob('chaosNodeFail', 'none')
    stepUntil(sim, () => nodeObj(sim, 'node-a').status.conditions[0].status, 3600, 'healed')
    expect(sim.state.events.some((e) => e.reason === 'NodeReady')).toBe(true)
  })
})
