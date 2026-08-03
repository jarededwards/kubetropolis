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
