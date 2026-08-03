/* Kubetropolis sim — deterministic, JSON-stable snapshots.
 *
 * Maps and Sets serialize as sorted arrays so that deep-equality between two
 * runs is meaningful regardless of insertion order. This is the surface the
 * determinism test compares and a future save/restore reads.
 */

import type { SimState } from '../core/types'

export function toSnapshot(state: SimState): unknown {
  return {
    tick: state.tick,
    now: round6(state.now),
    rngState: state.rngState,
    uidSeq: state.uidSeq,
    knobs: { ...state.knobs },
    scenario: state.scenario,
    scenarioRun: state.scenarioRun
      ? {
          ...state.scenarioRun,
          startedAt: round6(state.scenarioRun.startedAt),
          knobsBefore: { ...state.scenarioRun.knobsBefore },
          beat: state.scenarioRun.beat ? { ...state.scenarioRun.beat } : undefined,
          endsAt: state.scenarioRun.endsAt === undefined ? undefined : round6(state.scenarioRun.endsAt),
        }
      : null,
    etcd: {
      revision: state.etcd.revision,
      compactedRevision: state.etcd.compactedRevision,
      log: state.etcd.log.map((r) => ({ ...r })),
      objects: [...state.etcd.objects.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([uid, obj]) => [uid, obj]),
      members: state.etcd.members.map((m) => ({ ...m })),
      leader: state.etcd.leader,
      fsyncMs: state.etcd.fsyncMs,
      proposals: state.etcd.proposals.map((p) => ({
        readyAt: round6(p.readyAt),
        verb: p.req.verb,
        uid: p.req.obj.uid,
      })),
      nextCompactionAt: round6(state.etcd.nextCompactionAt),
      lastIntervalRevision: state.etcd.lastIntervalRevision,
    },
    api: {
      inflight: state.api.inflight.map((r) => ({
        verb: r.verb,
        uid: r.obj.uid,
        stage: r.stage,
        source: r.source,
        mutations: [...r.mutations],
      })),
      rejected: state.api.rejected,
      watchers: state.api.watchers.map((w) => ({
        subscriber: w.subscriber,
        kinds: [...w.kinds],
        sentRev: w.sentRev,
        latencyFactor: round6(w.latencyFactor),
        nextBookmarkAt: round6(w.nextBookmarkAt),
        needsRelist: w.needsRelist,
        relistAt: w.relistAt === undefined ? null : round6(w.relistAt),
        backlog: w.backlog.map((b) => ({ rev: b.rec.rev, visibleAt: round6(b.visibleAt) })),
      })),
    },
    sched: {
      queue: [...state.sched.queue],
      backoff: state.sched.backoff.map((b) => ({ uid: b.uid, until: round6(b.until) })),
      cycle: state.sched.cycle ?? null,
      scheduled: state.sched.scheduled,
      assumed: [...state.sched.assumed.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    },
    controllers: Object.fromEntries(
      Object.entries(state.controllers).map(([id, c]) => [
        id,
        {
          workqueue: [...c.workqueue],
          sentRev: c.sentRev,
          reconciles: c.reconciles,
          nextResyncAt: round6(c.nextResyncAt),
          nextPeriodicAt: c.nextPeriodicAt === undefined ? null : round6(c.nextPeriodicAt),
          expect: [...c.expect.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([uid, e]) => [uid, { ...e, expiresAt: round6(e.expiresAt) }]),
        },
      ]),
    ),
    nodes: state.nodes.map((n) => ({
      id: n.id,
      objUid: n.objUid,
      powered: n.powered,
      allocatable: { ...n.allocatable },
      allocated: { ...n.allocated },
      used: { cpuM: round6(n.used.cpuM) },
      proxy: {
        programmedRev: n.proxy.programmedRev,
        endpoints: n.proxy.endpoints.map((e) => ({ ...e, conditions: { ...e.conditions } })),
      },
      leaseRenewAt: round6(n.leaseRenewAt),
      imageCache: [...n.imageCache].sort(),
      pulls: n.pulls.map((p) => ({ ...p, doneMB: round6(p.doneMB) })),
      kubelet: {
        sentRev: n.kubelet.sentRev,
        syncQueue: [...n.kubelet.syncQueue],
        nextSweepAt: round6(n.kubelet.nextSweepAt),
        runtime: [...n.kubelet.runtime.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([uid, rt]) => [uid, roundRuntime(rt)]),
      },
    })),
    harbor: { ...state.harbor },
    traffic: { ...state.traffic, accumulator: round6(state.traffic.accumulator) },
    operatorRunning: state.operatorRunning,
    beacon: state.beacon
      ? {
          ...state.beacon,
          buildingUntil: round6(state.beacon.buildingUntil),
          fuelPct: round6(state.beacon.fuelPct),
          refuelArriveAt:
            state.beacon.refuelArriveAt === undefined ? null : round6(state.beacon.refuelArriveAt),
        }
      : null,
    drains: state.drains.map((d) => ({ ...d, nextAttemptAt: round6(d.nextAttemptAt) })),
    evictions: [...state.evictions.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([uid, at]) => [uid, round6(at)]),
    quotaRetries: state.quotaRetries.map((q) => ({ ...q, at: round6(q.at) })),
    counters: { ...state.counters },
    podOwners: [...state.podOwners.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
    events: state.events.map((e) => ({ ...e, at: round6(e.at) })),
    trace: state.trace,
    vitals: { ...state.vitals },
  }
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function roundRuntime(rt: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(rt)) {
    out[k] = typeof v === 'number' ? round6(v) : v
  }
  return out
}
