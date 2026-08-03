/* Kubetropolis sim — directed incidents (the ScenarioDef runtime).
 *
 * A scenario is data: knob overrides, scheduled canned actions, narration
 * beats, and at most one operator decision. The engine snapshots knobs on
 * entry and restores them on exit; every beat and decision reveal derives
 * from MODEL time, so a scripted scenario replays byte-identically. The city
 * keeps running throughout — a decision is an offer, never a pause.
 */

import { CLAIM_VALUES } from '../core/claims'
import type { Command, Knobs, ScenarioDef, SimState } from '../core/types'
import { actionFor } from './actions'
import { pushEvent } from './objects'
import { samples } from './samples'

const CL = CLAIM_VALUES.crashLoop

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'steady-state',
    name: 'Steady state',
    blurb: 'A healthy cluster. Learn what normal sounds like before you break it.',
    icon: '◎',
    knobs: {},
    focus: 'overview.balloon',
    duration: 90,
    ensureDeployment: true,
    beats: [
      [0, 'Nothing is idle',
        `Heartbeats every ${CLAIM_VALUES.kubeletHeartbeat.leaseRenewSeconds} model seconds, readiness `
        + `visits every ${CLAIM_VALUES.probes.periodSeconds}, couriers on every road. Watch the rhythm: `
        + 'a quiet cluster is a cadence, not a silence.'],
      [30, 'Read a district',
        'The substation needle is CPU requests; the water tower is memory. The gap between '
        + 'allocated and allocatable is the room the Zoning Office still has to work with.'],
      [70, 'Now break it',
        'Every other scenario changes one thing and lets the same streets carry the consequence. '
        + 'The menu is open.'],
    ],
  },
  {
    id: 'crashloop',
    name: 'Crash loop',
    blurb: 'The app keeps dying. Watch the delay double.',
    icon: '↻',
    knobs: { chaosCrashLoop: true },
    focus: 'node.a.gate',
    duration: 150,
    ensureDeployment: true,
    beats: [
      [0, 'Twenty seconds of hope',
        'The container starts, runs, and exits. The foreman rebuilds — and starts a stopwatch.'],
      [35, `${CL.baseSeconds}, ${CL.baseSeconds * 2}, ${CL.baseSeconds * 4}`,
        `Each rebuild waits twice as long as the last, capped at ${CL.capSeconds} model seconds. `
        + 'The city is not being lazy; it is refusing to burn the district down with restarts.'],
      [90, 'The reset rule',
        `${CL.resetAfterCleanSeconds} clean model seconds would zero the ladder. This app never `
        + 'gets there. The newspaper shows BackOff filings; kubectl would show the same.'],
    ],
  },
  {
    id: 'oomkill',
    name: 'OOM kill',
    blurb: 'v2 has a leak. The tower overflows on a schedule.',
    icon: '▲',
    knobs: { chaosOomLeak: true },
    focus: 'node.a.watertower',
    duration: 0,
    ensureDeployment: true,
    actionAt: [[20, 'set-image-v2']],
    beats: [
      [0, 'The rollout looked fine',
        'v2 passes its readiness checks and the renovation wave completes. Leaks do not fail '
        + 'probes; they fail arithmetic.'],
      [95, 'Exit 137',
        'Usage crossed the limit, and the kernel — not Kubernetes — pulled the breaker. The '
        + 'building goes dark and the restart ladder begins, with the leak intact.'],
      [130, 'Limits are a contract',
        'The Zoning Office placed this building by its requests; the blackout enforced its '
        + 'limit. Both numbers were yours.'],
    ],
    decision: {
      revealAt: 150,
      choices: [
        {
          id: 'raise-limit',
          label: 'Raise the limit',
          hint: 'A template change — the whole wave rebuilds with taller towers',
          effect: {
            command: samples.setLimit(1024),
            consequence:
              'The towers rebuild taller — a limit change is a rollout. The leak keeps climbing; '
              + 'you bought minutes, not a fix.',
          },
        },
        {
          id: 'rollout-undo',
          label: 'kubectl rollout undo',
          hint: 'v1 had no leak; the renovation runs in reverse',
          effect: {
            command: samples.rollback(),
            consequence:
              'The old contract scales back up — no third contract, the previous one was kept '
              + 'at zero for exactly this moment.',
          },
        },
        {
          id: 'add-replicas',
          label: 'Add replicas',
          hint: 'More buildings — watch why this is not a fix',
          effect: {
            command: samples.scale(5),
            consequence:
              'Five buildings now leak in parallel. Capacity is not a treatment for a leak; the '
              + 'blackouts simply take turns.',
          },
        },
      ],
    },
  },
  {
    id: 'image-pull-storm',
    name: 'Image-pull storm',
    blurb: 'The registry goes down, and you chose this moment to ship v2.',
    icon: '☁',
    knobs: {},
    focus: 'harbor.crane',
    duration: 140,
    ensureDeployment: true,
    knobsAt: [[20, { chaosRegistryOutage: true }]],
    actionAt: [[26, 'set-image-v2']],
    beats: [
      [0, 'Before the storm',
        'Three doors open on v1, every district holding the image on its shelf. Remember what '
        + 'healthy looks like.'],
      [20, 'Fog on the water',
        'The crane stops. The running city does not care — images matter only at birth.'],
      [48, 'Two cities',
        'Every v1 door stays open while the v2 wave stalls at the quay: ErrImagePull, then '
        + 'ImagePullBackOff, doubling toward its cap. The renovation is paused; the city is not.'],
      [105, 'The quiet dependency',
        'Every rollout and every reschedule is a bet on the harbor. Warm caches and unhurried '
        + 'rollouts are why today was survivable.'],
    ],
  },
  {
    id: 'rollout-surge',
    name: 'Rollout, three ways',
    blurb: 'The same update under three pacing contracts — under live traffic.',
    icon: '⇶',
    knobs: { reqPerSec: 120 },
    focus: 'service.directory',
    duration: 200,
    ensureDeployment: true,
    ensureService: true,
    actionAt: [
      [12, 'set-image-v2'],
    ],
    knobsAt: [
      [70, { maxSurgePct: 0, maxUnavailablePct: 50 }],
      [130, { maxSurgePct: 100, maxUnavailablePct: 0 }],
    ],
    beats: [
      [0, 'Rush hour, then a renovation',
        `${CLAIM_VALUES.rollingUpdate.surgePct}% over budget, ${CLAIM_VALUES.rollingUpdate.unavailablePct}% short — the default contract. `
        + 'Watch the directory board: the listed count dips and recovers as the wave walks.'],
      [70, 'Surge zero',
        'Never a building over budget — but half the doors may be dark at once. The board shows '
        + 'what caution costs: capacity pays for it.'],
      [130, 'Unavailable zero',
        'A full second city for a moment, and the listed count never dips. Availability paid in '
        + 'district headroom — look at what the Zoning Office had to find.'],
      [185, 'Same v2, three prices',
        'The template change was identical each time. The pacing contract decided who paid — '
        + 'capacity, availability, or headroom.'],
    ],
  },
  {
    id: 'paper-law',
    name: 'Paper law',
    blurb: 'Pass the law, file the permit, staff nobody. Watch how much nothing happens.',
    icon: '¶',
    knobs: {},
    focus: 'harbor.lighthouse',
    duration: 0,
    ensureOperatorOff: true,
    actionAt: [
      [2, 'apply-crd'],
      [8, 'apply-lighthouse'],
    ],
    beats: [
      [0, 'Stored, revisioned, real',
        'The council passes the law and the permit is filed. City Hall opens a counter '
        + 'window; the vault gains a row. Every proper channel has done its proper thing.'],
      [20, 'The breakwater is dark',
        'No office subscribes to Lighthouses. The couriers went out; nobody was waiting at '
        + 'the end of any road. The row does not age, does not retry, does not complain — it '
        + 'simply waits, forever if you let it.'],
      [45, 'Staff the shack',
        'An operator is an ordinary process holding a watch. The moment one runs, the row '
        + 'becomes a building — and stays one only as long as the process stays up.'],
    ],
    decision: {
      revealAt: 60,
      choices: [
        {
          id: 'staff',
          label: 'Staff the shack',
          hint: 'Start the operator — its watch begins',
          effect: {
            command: samples.setOperator(true),
            consequence:
              'The shack lights, the courier walks the shore road, the tower rises and '
              + 'ignites — and the operator keeps it burning from here on.',
          },
        },
        {
          id: 'leave-dark',
          label: 'Leave it dark',
          hint: 'Honest: nothing will ever happen',
          effect: {
            consequence:
              'The row will outlive your patience. Nothing in the control plane ages it, '
              + 'retries it, or mourns it — a law with no inspector is paper.',
          },
        },
      ],
    },
  },
  {
    id: 'readiness-flake',
    name: 'Readiness flake',
    blurb: 'A shop keeps failing its checks. Traffic reroutes; the wreckers never come.',
    icon: '⚑',
    knobs: { reqPerSec: 100, chaosReadinessFlake: true },
    focus: 'service.junction',
    duration: 160,
    ensureDeployment: true,
    ensureService: true,
    beats: [
      [0, 'The checks start failing',
        `An inspector visits every ${CLAIM_VALUES.probes.periodSeconds} model seconds. `
        + `${CLAIM_VALUES.probes.failureThreshold} misses in a row and the CLOSED sign flips — `
        + 'nothing else happens to the building.'],
      [45, 'The listing drops',
        'The directory files a smaller edition; each district signage copies it a courier later. '
        + 'In that window a few callers still reach the closed door — count them on the junction '
        + 'board. Then the traffic simply flows around.'],
      [100, 'Zero restarts',
        'Look at the restart counter: zero. Readiness unlists; liveness would have sent the '
        + 'wreckers. The building was never in danger — only unlisted, and only until its checks '
        + 'pass again.'],
    ],
  },
  {
    id: 'node-notready',
    name: 'Node NotReady',
    blurb: 'A district goes dark. Two clocks start; both are the lesson.',
    icon: '◼',
    knobs: {},
    focus: 'node.b.gate',
    duration: 0,
    ensureDeployment: true,
    knobsAt: [[5, { chaosNodeFail: 'node-b' }]],
    beats: [
      [0, 'Silence is data',
        'We cut power to node-b in five seconds. Then watch how long nothing happens: networks '
        + 'blip far more often than districts die, and City Hall knows it.'],
      [58, 'NotReady, tainted',
        `No heartbeat for ${CLAIM_VALUES.nodeMonitor.graceSeconds} model seconds — the lifecycle desk marks the district `
        + 'Unknown and posts the unreachable taints. Now every building carries a countdown: the '
        + `${CLAIM_VALUES.tolerations.defaultSeconds}-second toleration it never asked for.`],
      [320, 'The rebuild',
        'Countdowns expire, rows are removed with NodeLost, and the contract rebuilds in live '
        + 'districts. Check the substations absorbing the load. Nothing here needed you.'],
    ],
    decision: {
      revealAt: 90,
      choices: [
        {
          id: 'wait',
          label: 'Wait it out',
          hint: 'Honest: five minutes. This is the default for a reason',
          effect: {
            consequence:
              'The countdowns run their course. False alarms cost nothing this way; real failures '
              + 'cost five patient minutes.',
          },
        },
        {
          id: 'force-delete',
          label: 'kubectl delete --force',
          hint: 'Remove the rows without the foreman\'s confirmation',
          effect: {
            commandsFor: (state) => {
              const out = []
              for (const o of state.etcd.objects.values()) {
                if (o.kind === 'Pod' && o.spec.nodeName === 'node-b' && !o.deletionTimestamp) {
                  out.push(samples.forceDelete(o.name))
                }
              }
              return out
            },
            consequence:
              'The rows vanish and replacements file immediately. If those buildings held state, '
              + 'reality just forked — the force flag is a promise that they did not.',
          },
        },
        {
          id: 'shorten-toleration',
          label: 'Shorten the toleration',
          hint: 'Tune the dial down to 30 — faster failover, twitchier false alarms',
          effect: {
            knobs: { unreachableTolerationSec: 30 },
            consequence:
              'The running countdowns shrink to thirty seconds. Every future network blip now '
              + 'costs a rebuild — you traded patience for speed, cluster-wide.',
          },
        },
      ],
    },
  },
  {
    id: 'pdb-blocked-drain',
    name: 'PDB-blocked drain',
    blurb: 'Maintenance meets a promise you made to stay available.',
    icon: '⛔',
    knobs: { pdbEnabled: true, pdbMinAvailable: 3 },
    focus: 'node.b.gate',
    duration: 0,
    ensureDeployment: true,
    actionAt: [[12, 'drain-node']],
    beats: [
      [0, 'The budget first',
        'A disruption budget is filed: keep three shopfronts available. Remember that number.'],
      [12, 'Cordon, then paperwork',
        'The district refuses new permits, and the drain begins — eviction filings, one building '
        + 'at a time. A drain is paperwork, not a bulldozer.'],
      [40, `${CLAIM_VALUES.disruption.evictionBlockedStatus}, politely`,
        'Three must stay available and three are all we have. Every filing comes back DENIED '
        + 'along the eviction road, and the drain retries with backoff. Nothing is broken: two '
        + 'true statements cannot both be satisfied yet.'],
    ],
    decision: {
      revealAt: 75,
      choices: [
        {
          id: 'scale-first',
          label: 'Scale up first',
          hint: 'Add capacity elsewhere; the budget frees itself',
          effect: {
            command: samples.scale(5),
            consequence:
              'New buildings rise in open districts, the ready count clears the budget, and the '
              + 'stalled drain\'s next retry goes through. Capacity was the answer, not force.',
          },
        },
        {
          id: 'override',
          label: 'Delete the pods directly',
          hint: 'PDB guards evictions, not deletes',
          effect: {
            commandsFor: (state) => {
              const out = []
              for (const o of state.etcd.objects.values()) {
                if (o.kind === 'Pod' && o.spec.nodeName === 'node-b' && !o.deletionTimestamp) {
                  out.push(samples.deletePod(o.name))
                }
              }
              return out
            },
            consequence:
              'It works — the budget never even sees a delete. And it is exactly the promise you '
              + 'break: the availability floor you filed is now fiction.',
          },
        },
        {
          id: 'wait',
          label: 'Keep retrying',
          hint: 'Correct whenever the budget frees',
          effect: {
            consequence:
              'The drain keeps filing on its backoff, forever. The moment anything frees the '
              + 'budget — a scale-up, a recovered door — it completes without you.',
          },
        },
      ],
    },
  },
  {
    id: 'hpa-flap',
    name: 'Rush hour',
    blurb: 'Traffic doubles, then halves. The window and the deadband earn their keep.',
    icon: '↗',
    knobs: { hpaEnabled: true, hpaTargetCpuPct: 50, hpaMax: 10, reqPerSec: 220 },
    focus: 'inspectors.office',
    duration: 480,
    ensureDeployment: true,
    ensureService: true,
    knobsAt: [[140, { reqPerSec: 40 }]],
    beats: [
      [0, 'One division, every fifteen seconds',
        `The desk computes usage over target every ${CLAIM_VALUES.hpa.syncSeconds} model seconds and edits exactly one `
        + 'number on the Deployment. That is everything it is permitted to do.'],
      [60, 'The ratio crossed the deadband',
        `Past ±${CLAIM_VALUES.hpa.tolerancePct}% of target, the desk writes: desired = ceil(current × usage/target). `
        + 'Watch the city turn one edit into buildings.'],
      [140, 'Traffic halves',
        'And no demolition follows. The desk acts on the HIGHEST recommendation of the last '
        + `${CLAIM_VALUES.hpa.stabilizationSeconds} model seconds — flapping is more expensive than patience.`],
      [440, 'The window closes',
        'Only now, with the whole window quiet, does the lower number get written. Scale-up is '
        + 'eager; scale-down is deliberately slow.'],
    ],
  },
  {
    id: 'etcd-slow',
    name: 'The ledger limps',
    blurb: 'The vault slows and the leader flaps. Notice what still works.',
    icon: '≋',
    knobs: { chaosEtcdSlow: true, chaosLeaderFlap: true, reqPerSec: 120 },
    focus: 'records.vault',
    duration: 120,
    ensureDeployment: true,
    ensureService: true,
    beats: [
      [0, 'Fsync at 500 model-ms',
        'Every stamp in the vault drags, and elections keep stealing the pen. Watch the permit '
        + 'hall queue and the couriers\' lag climb.'],
      [40, 'Try to change anything',
        'Scale, delete, apply — paperwork piles at the desk. The control plane is a database '
        + 'application, and its database is sick.'],
      [85, 'The city still serves',
        'Cars still reach open doors: the junction and every district signage run on PROGRAMMED '
        + 'copies, not live ledger reads. A cluster that cannot change can still work — until '
        + 'something else breaks.'],
    ],
  },
  {
    id: 'quota-exhausted',
    name: 'Quota exhausted',
    blurb: 'The neighborhood has a permit cap. The desk does not sulk.',
    icon: '#',
    knobs: { chaosQuotaLow: true },
    focus: 'cityhall.permitdesk',
    duration: 0,
    ensureDeployment: true,
    commandsAt: [[10, { kind: 'Scale', deployment: 'shopfront', replicas: 12 }]],
    beats: [
      [0, 'Eight permits for shops',
        'The quota kiosk counts objects, not intentions. Eight is the cap; three are standing.'],
      [22, 'FailedCreate',
        'You asked for twelve. The ReplicaSet desk files permit nine and gets it back stamped — '
        + 'and files again on its backoff, forever. Inspectors do not sulk.'],
      [70, 'Desired 12, running 8',
        'The Deployment reports the gap honestly in status. Nothing is wrong except arithmetic. '
        + 'Raise the cap, or want less.'],
    ],
    decision: {
      revealAt: 90,
      choices: [
        {
          id: 'raise-quota',
          label: 'Lift the cap',
          hint: 'Capacity planning by decree',
          effect: {
            knobs: { chaosQuotaLow: false },
            consequence:
              'The kiosk closes, the desk\'s next retry clears, and the remaining four permits '
              + 'file in one breath. The gap was policy, not physics.',
          },
        },
        {
          id: 'lower-replicas',
          label: 'Want less',
          hint: 'Match the ask to the cap',
          effect: {
            command: samples.scale(8),
            consequence:
              'Desired equals possible; the FailedCreate filings stop. The quota did its job: it '
              + 'made you decide on purpose.',
          },
        },
      ],
    },
  },
]

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

/* ---------------------------------------------------------------------------
 * Engine — driven from the model tick; UI only reads state.scenarioRun.
 * -------------------------------------------------------------------------*/

export function startScenario(state: SimState, id: string): void {
  const def = scenarioById(id)
  if (!def || state.scenarioRun) return
  state.scenarioRun = {
    id,
    startedAt: state.now,
    knobsBefore: { ...state.knobs },
    setupDone: false,
    actionIdx: 0,
    commandIdx: 0,
    knobIdx: 0,
    beatIdx: 0,
    decisionAvailable: false,
    endsAt: def.duration > 0 ? state.now + def.duration : undefined,
  }
  state.scenario = id
  applyKnobs(state, def.knobs)
  pushEvent(state, 'Normal', 'ScenarioStarted', def.name, def.blurb)
}

export function endScenario(state: SimState): void {
  const run = state.scenarioRun
  if (!run) return
  applyKnobs(state, run.knobsBefore)
  state.scenarioRun = null
  state.scenario = null
  pushEvent(state, 'Normal', 'ScenarioEnded', run.id, 'knobs restored — the city is yours again')
}

export function applyScenarioChoice(
  state: SimState,
  choiceId: string,
  run: (cmd: Command) => void,
): void {
  const sr = state.scenarioRun
  if (!sr || !sr.decisionAvailable || sr.choiceTaken) return
  const def = scenarioById(sr.id)
  const choice = def?.decision?.choices.find((c) => c.id === choiceId)
  if (!choice) return
  sr.choiceTaken = choice.id
  sr.decisionAvailable = false
  sr.consequence = choice.effect.consequence
  if (choice.effect.knobs) applyKnobs(state, choice.effect.knobs)
  if (choice.effect.command) run(choice.effect.command)
  if (choice.effect.commandsFor) for (const cmd of choice.effect.commandsFor(state)) run(cmd)
  pushEvent(state, 'Normal', 'ScenarioChoice', sr.id, `${choice.label} — ${choice.effect.consequence}`)
}

export function stepScenario(state: SimState, run: (cmd: Command) => void): void {
  const sr = state.scenarioRun
  if (!sr) return
  const def = scenarioById(sr.id)
  if (!def) {
    state.scenarioRun = null
    return
  }
  const t = state.now - sr.startedAt

  if (!sr.setupDone) {
    sr.setupDone = true
    if (def.ensureDeployment && !hasDeployment(state, 'shopfront')) {
      run(samples.deployment(3))
    }
    if (def.ensureService && !hasService(state)) {
      run(samples.service())
    }
    if (def.ensureOperatorOff && state.operatorRunning) {
      run(samples.setOperator(false))
    }
  }

  const knobChanges = def.knobsAt ?? []
  while (sr.knobIdx < knobChanges.length && knobChanges[sr.knobIdx][0] <= t) {
    applyKnobs(state, knobChanges[sr.knobIdx][1])
    sr.knobIdx += 1
  }

  const commands = def.commandsAt ?? []
  while (sr.commandIdx < commands.length && commands[sr.commandIdx][0] <= t) {
    const [, cmd] = commands[sr.commandIdx]
    sr.commandIdx += 1
    run(cmd)
  }

  const actions = def.actionAt ?? []
  while (sr.actionIdx < actions.length && actions[sr.actionIdx][0] <= t) {
    const [, kind] = actions[sr.actionIdx]
    sr.actionIdx += 1
    const action = actionFor(kind)
    if (action) {
      run(action.mkCommand(state))
      pushEvent(state, 'Normal', 'ScenarioAction', sr.id, action.cmdFor?.(state) ?? action.cmd)
    }
  }

  const beats = def.beats ?? []
  while (sr.beatIdx < beats.length && beats[sr.beatIdx][0] <= t) {
    const [at, title, body] = beats[sr.beatIdx]
    sr.beatIdx += 1
    sr.beat = { title, body, at }
  }

  if (def.decision && !sr.choiceTaken && !sr.decisionAvailable && t >= def.decision.revealAt) {
    sr.decisionAvailable = true
  }

  if (sr.endsAt !== undefined && state.now >= sr.endsAt) endScenario(state)
}

function hasDeployment(state: SimState, name: string): boolean {
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'Deployment' && o.name === name) return true
  }
  return false
}

function hasService(state: SimState): boolean {
  for (const o of state.etcd.objects.values()) {
    if (o.kind === 'Service') return true
  }
  return false
}

/** Knob writes with their mirrors — the scenario engine's setKnob. */
export function applyKnobs(state: SimState, partial: Partial<Knobs>): void {
  Object.assign(state.knobs, partial)
  state.harbor.mbps = state.knobs.registryMBps
  state.harbor.reachable = !state.knobs.chaosRegistryOutage
  state.traffic.reqPerSec = state.knobs.reqPerSec
}
