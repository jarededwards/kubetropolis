import { describe, expect, it } from 'vitest'

import { CLAIM_VALUES } from '../core/claims'
import type { PodObj } from '../core/types'
import { samples } from './model'
import { mkSim, podNamed, step, stepUntil } from './test-support'

describe('API server — the permit hall', () => {
  it('advances one admission stage per tick: authn → mutating → validating → toEtcd', () => {
    const sim = mkSim()
    sim.apply(samples.pod('staged'))
    // Heartbeat renewals share the hall; track only the kubectl request.
    const mine = () => sim.state.api.inflight.find((r) => r.source === 'kubectl')
    step(sim, 1)
    expect(mine()?.stage).toBe('mutating')
    step(sim, 1)
    expect(mine()?.stage).toBe('validating')
    step(sim, 1)
    expect(mine()?.stage).toBe('toEtcd')
    step(sim, 1)
    expect(mine()).toBeUndefined()
    expect(sim.state.etcd.proposals.length + sim.state.etcd.log.length).toBeGreaterThan(0)
  })

  it('the desk finishes your manifest: probes, tolerations, grace, pull policy', () => {
    const sim = mkSim()
    sim.apply(samples.pod('stamped'))
    stepUntil(sim, (s) => podNamed(s, 'stamped') !== undefined, 30, 'pod stored')
    const pod = podNamed(sim.state, 'stamped')! as PodObj

    expect(pod.spec.probes.readiness.periodSeconds).toBe(CLAIM_VALUES.probes.periodSeconds)
    expect(pod.spec.probes.readiness.failureThreshold).toBe(CLAIM_VALUES.probes.failureThreshold)
    expect(pod.spec.probes.liveness.periodSeconds).toBe(CLAIM_VALUES.probes.periodSeconds)

    expect(pod.spec.tolerations).toEqual([
      { key: 'node.kubernetes.io/not-ready', seconds: CLAIM_VALUES.tolerations.defaultSeconds },
      { key: 'node.kubernetes.io/unreachable', seconds: CLAIM_VALUES.tolerations.defaultSeconds },
    ])

    expect(pod.spec.tgps).toBe(CLAIM_VALUES.termination.defaultGraceSeconds)
    // harbor.city/shopfront:v1 is tagged and not :latest
    expect(pod.spec.imagePullPolicy).toBe('IfNotPresent')
  })

  it('records the stamped mutations as the receipt the trace will narrate', () => {
    const sim = mkSim()
    sim.apply(samples.pod('receipt'))
    step(sim, 2) // authn, then mutating has run
    const req = sim.state.api.inflight[0]
    expect(req.mutations.join(' ')).toContain('probes defaulted')
    expect(req.mutations.join(' ')).toContain('tolerations injected')
    expect(req.mutations.join(' ')).toContain('terminationGracePeriodSeconds')
  })
})
