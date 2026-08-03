/* ============================================================================
 * Kubetropolis — the simulation facade.
 *
 * createSim(bus) owns one mutable SimState, advanced ONLY by fixed steps from
 * the frame timebase. The tick pipeline is the pedagogy (plan §sim-core):
 * every stage moves state at most one hop, and every reaction that changes
 * the cluster re-enters at the permit hall — the pipeline structurally
 * forbids the shortcut every wrong Kubernetes diagram implies.
 *
 *   1. intake      — queued commands become API requests (kubectl = client)
 *   2. admission   — authn → mutating (defaults stamped) → validating → toEtcd
 *   3. etcd        — quorum+fsync, then revision++, log, materialize
 *   4. fan-out     — committed records → every subscriber's courier backlog,
 *                    then deliveries whose latency elapsed
 *   5. controllers — desks compare spec to street, write differences back
 *   6. scheduler   — filter, score, bind-as-a-write
 *   7. kubelets    — pulls, creates, probes, backoff, termination; heartbeats
 *   9. chaos/maint — power cuts, compaction sweep
 *  10. derive      — allocations, vitals, event trim
 *
 * (Stage 8, the data plane, arrives at M6 with Services.)
 *
 * Boundary rules (test-enforced): no three.js, no src/world, no wall clock,
 * no unseeded randomness anywhere under src/sim.
 * ==========================================================================*/

import { CLAIM_VALUES } from '../core/claims'
import type { Bus, Command, Knobs, SimApi, SimState } from '../core/types'
import { DEFAULT_KNOBS } from '../core/types'
import { drainWatchers, findPodByName, stepAdmission, stepWatchFanout, submit } from './apiserver'
import { CONTROLLER_BUDGET, clone, mkDeployment, mkPod, pushEvent, rng01 } from './objects'
import { reconcileDeployment } from './controllers/deployment'
import { reconcileReplicaSet } from './controllers/replicaset'
import { effectiveFsyncMs, stepCompaction, stepEtcdCommits } from './etcd'
import { stepKubelets } from './kubelet'
import { applyNodeChaos, stepLeaseRenewals, stepNodeLifecycle } from './nodes'
import { stepScheduler } from './scheduler'
import { DEFAULT_SEED, initState } from './state'
import { toSnapshot } from './snapshot'
import { actionFor } from './actions'
import { armTrace, endTrace, resumeTraceStep, setTracePlayback, updateTrace } from './trace'
import { derive } from './vitals'

export { samples } from './samples'

export interface SimOptions {
  seed?: number
  knobs?: Partial<Knobs>
}

export function createSim(bus: Bus, opts?: SimOptions): SimApi {
  const baseKnobs = (): Knobs => ({ ...DEFAULT_KNOBS, ...opts?.knobs })
  let state: SimState = initState(opts?.seed ?? DEFAULT_SEED, baseKnobs())
  const intake: Command[] = []

  function tick(dt: number): void {
    // 1 — intake
    while (intake.length > 0) runCommand(state, intake.shift()!)

    // 2..4 — the permit hall and the vault
    stepAdmission(state)
    state.etcd.fsyncMs = effectiveFsyncMs(state)
    const committed = stepEtcdCommits(state)
    stepWatchFanout(state, committed)
    drainWatchers(state)

    // 5 — the desks (deployment before replicaset so a fresh contract can be
    // worked the same tick it is delivered; nodelifecycle on its own clock)
    runController(state, 'deployment', reconcileDeployment)
    runController(state, 'replicaset', reconcileReplicaSet)
    stepNodeLifecycle(state)

    // 6 — zoning
    stepScheduler(state)

    // 7 — foremen
    stepLeaseRenewals(state)
    stepKubelets(state, dt)

    // 9 — chaos & maintenance
    applyNodeChaos(state)
    stepCompaction(state)

    // 10 — derive
    state.now += dt
    state.tick += 1
    derive(state)
    updateTrace(state)

    // flush packet emissions to the bus (transient; empty between ticks)
    if (state.flowOutbox.length > 0) {
      for (const f of state.flowOutbox) {
        bus.emit('flow', { route: f.route, kind: f.kind, count: f.count })
      }
      state.flowOutbox.length = 0
    }
  }

  function runController(
    s: SimState,
    id: 'deployment' | 'replicaset',
    reconcile: (s2: SimState, uid: string) => void,
  ): void {
    const ctl = s.controllers[id]
    // B6 companion: the periodic resync re-enqueues every owned key, so a
    // desk that missed (or leaked) an event always gets another look. Jittered
    // via the seeded RNG — deterministic, but desks do not thunder together.
    if (s.now >= ctl.nextResyncAt) {
      const kind = id === 'deployment' ? 'Deployment' : 'ReplicaSet'
      for (const o of s.etcd.objects.values()) {
        if (o.kind === kind && !ctl.workqueue.includes(o.uid)) ctl.workqueue.push(o.uid)
      }
      ctl.nextResyncAt =
        s.now + CLAIM_VALUES.controllerExpectations.resyncSeconds + rng01(s) * 60
    }
    for (let i = 0; i < CONTROLLER_BUDGET && ctl.workqueue.length > 0; i++) {
      const uid = ctl.workqueue.shift()!
      ctl.current = uid
      reconcile(s, uid)
      ctl.reconciles += 1
    }
    ctl.current = undefined
  }

  const api: SimApi = {
    get state() {
      return state
    },
    update(dt: number): void {
      if (dt <= 0) return
      tick(dt)
    },
    apply(command: Command): void {
      intake.push(command)
    },
    setKnob(key, value) {
      state.knobs[key] = value as never
      if (key === 'registryMBps') state.harbor.mbps = state.knobs.registryMBps
      if (key === 'reqPerSec') state.traffic.reqPerSec = state.knobs.reqPerSec
    },
    startTrace(action, playback) {
      const def = actionFor(action)
      if (!def?.traceable) return
      armTrace(state, action, def.subject, playback)
      intake.push(def.mkCommand())
    },
    traceNext() {
      resumeTraceStep(state)
    },
    setTracePlayback(playback) {
      setTracePlayback(state, playback)
    },
    endTrace() {
      endTrace(state)
    },
    toSnapshot() {
      return toSnapshot(state)
    },
    reset(seed = opts?.seed ?? DEFAULT_SEED): void {
      state = initState(seed, baseKnobs())
      intake.length = 0
      bus.emit('sim:reset', {})
    },
  }
  return api
}

/** Commands translate into API writes — kubectl is just another client. */
function runCommand(state: SimState, command: Command): void {
  // The client's manifest travels the arrivals avenue to the permit desk.
  state.flowOutbox.push({ route: 'apply.in', kind: 'apply' })
  if (command.kind === 'ApplyPod') {
    const pod = mkPod(state, command.name, {
      image: command.image,
      requests: command.requests ?? {
        cpuM: state.knobs.podCpuRequestM,
        memMi: state.knobs.podMemRequestMi,
      },
      limitMemMi: command.limitMemMi ?? state.knobs.podMemLimitMi,
    })
    submit(state, 'create', pod, 'kubectl')
    pushEvent(state, 'Normal', 'Applied', pod.name, 'pod manifest submitted')
    return
  }

  if (command.kind === 'ApplyDeployment') {
    const dep = mkDeployment(state, command.name, {
      replicas: command.replicas,
      template: {
        image: command.image,
        requests: command.requests ?? {
          cpuM: state.knobs.podCpuRequestM,
          memMi: state.knobs.podMemRequestMi,
        },
        limitMemMi: command.limitMemMi ?? state.knobs.podMemLimitMi,
      },
      maxSurgePct: state.knobs.maxSurgePct,
      maxUnavailablePct: state.knobs.maxUnavailablePct,
    })
    submit(state, 'create', dep, 'kubectl')
    pushEvent(state, 'Normal', 'Applied', dep.name, `deployment manifest submitted (replicas ${command.replicas})`)
    return
  }

  if (command.kind === 'Scale') {
    for (const obj of state.etcd.objects.values()) {
      if (obj.kind === 'Deployment' && obj.name === command.deployment) {
        const next = clone(obj)
        next.spec.replicas = command.replicas
        // Scaling bumps generation (any spec change does — the server owns
        // it), but the template and its hash stand still: no new ReplicaSet,
        // no rollout revision. Same conclusion, honest mechanism (B2).
        submit(state, 'update', next, 'kubectl')
        pushEvent(state, 'Normal', 'Scaled', obj.name, `desired replicas → ${command.replicas}`)
        return
      }
    }
    pushEvent(state, 'Warning', 'NotFound', command.deployment, 'no such deployment to scale')
    return
  }

  // DeletePod
  const pod = findPodByName(state, command.name)
  if (!pod) {
    pushEvent(state, 'Warning', 'NotFound', command.name, 'no such pod to delete')
    return
  }
  submit(state, 'delete', clone(pod), 'kubectl')
  pushEvent(state, 'Normal', 'DeleteRequested', pod.name, 'demolition paperwork filed')
}

export type { Knobs, SimApi, SimState }
