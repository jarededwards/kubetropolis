# KNOB-AUDIT — every knob visibly changes the city

Discipline inherited from the reference project: a knob that changes nothing
visible is a lie. Every WIRED knob lists its observable and its proof (a test
name, a scenario, or a screenshot pair). Knobs whose mechanics land at a later
milestone are listed as *dormant* — they may not appear in any reader-facing
surface until wired.

| Knob | Visible effect | Proof |
|---|---|---|
| `timeScale` | everything slows/accelerates; identical outcomes | determinism.test — 1× vs 4× byte-identical to the same model horizon |
| `paused` | the world freezes mid-step, trace stops hold | trace.test step-mode |
| `maxSurgePct` | extra pads under construction during a wave | rolling.test — total spec ≤ desired+surge; `m4-rolling-25-25.png` vs `m4-rolling-0-50.png` |
| `maxUnavailablePct` | how many doors may be dark at once | rolling.test — ready floor = desired−unavailable, timeline-verified |
| `readinessPeriodSec` | inspector visit cadence at doors; CLOSED detection latency | knob-response.test |
| `livenessPeriodSec` | stamped in the admission receipt (kill path arrives with liveness chaos) | apiserver.test (stamp) — *mechanism dormant, disclosed in FIDELITY.md* |
| `failureThreshold` | strikes before CLOSED | chaos.test flake + knob-response.test |
| `initialDelaySec` | grace before the first visit; gates rolling waves | knob-response.test; rolling.test readiness-gate |
| `tgpsSec` | demolition-notice countdown length | knob-response.test |
| `preStopSleepSec` | SIGTERM delayed inside the grace, never past it | knob-response.test; kubelet.test B1 |
| `nodeCount` | districts light up; spread uses them | knob-response.test |
| `podCpuRequestM` / `podMemRequestMi` | building width on substation/water meters; FailedScheduling when a district fills | knob-response.test; node-district readouts |
| `podMemLimitMi` | the overflow line the kernel enforces | chaos.test OOM; scenario oomkill raise-limit branch |
| `imageSizeMB` | crane load and pull duration | knob-response.test |
| `registryMBps` | crane speed | knob-response.test; harbor.crane readout |
| `unreachableTolerationSec` | stamped in the receipt (eviction countdown arrives M8) | apiserver.test — *countdown dormant, disclosed* |
| `nodeGraceSec` | how long City Hall waits before NotReady | nodes.test |
| `etcdFsyncMs` | vault stamp cadence; every write later | knob-response.test |
| `watchLatencyMs` | courier speed on every road | knob-response.test |
| `chaosCrashLoop` | 20s-lived containers; the doubling ladder | chaos.test; scenario crashloop |
| `chaosOomLeak` | v2 water rises until the breaker | chaos.test; scenario oomkill |
| `chaosReadinessFlake` | CLOSED signs flicker in 40s windows, zero restarts | chaos.test |
| `chaosRegistryOutage` | harbor fog, crane idle, ErrImagePull→ImagePullBackOff | chaos.test; scenario image-pull-storm; `m4-fog.png` |
| `chaosNodeFail` | district blackout → Unknown + taints, pods unready | nodes.test (fidelity B3/B10) |

| `reqPerSec` | callers off the ramp; junction served counter; substation heat | knob-response.test; services.test |
| `reqCpuCostM` | power drawn per served request (HPA's future metric) | knob-response.test |
| `chaosReadinessFlake` (M6 extension) | flaking apps fail USERS in the same windows — misroute blips until the listing drops | services.test; scenario readiness-flake |

~~Dormant~~ **All knobs wired as of M8** — the table below closes the ledger.

## M7 — no new knobs, one new switch

The operator is deliberately NOT a knob: it is a process, toggled by the
`SetOperator` command (shack inspector panel, tour, scenario decision, or the
rail's staff button). Its observable is the entire M7 arc — shack lamp,
construction, beam, fuel gauge, refuel truck — proven by
`src/sim/lighthouse.test.ts` and the rail hold in `m7-dark-breakwater.png` /
`m7-ignition.png`.

## M8 — self-healing and scale (every remaining knob wired)

| Knob | Visible effect | Proven by |
|---|---|---|
| `unreachableTolerationSec` | the LIVE countdown dial: armed clocks blink faster as `armedAt + dial` nears; shortening it mid-run shortens running countdowns (dial, not history — FIDELITY) | m8-chaos.test (two clocks); scenario node-notready decision |
| `nodeGraceSec` | how long City Hall waits before Unknown + taints | m8-chaos.test; nodes.test |
| `hpaEnabled` | the autoscaler desk receives its charter: lamp on, paper spike renders | m8-chaos.test (autoscaler desk); scenario hpa-flap |
| `hpaTargetCpuPct` | the division's denominator — lower target, earlier scale-up | m8-chaos.test |
| `hpaMin` / `hpaMax` | fences the desk cannot write past | controllers/hpa.ts clamp; m8-chaos.test peak ≤ max |
| `pdbEnabled` | a budget object is filed; drains start bouncing | m8-chaos.test (blocked drain) |
| `pdbMinAvailable` | the availability floor evictions may not breach | m8-chaos.test (3-vs-3 deadlock, frees at 5) |
| `chaosQuotaLow` | quota kiosk caps pods at 8; FailedCreate stamps + retry-forever | m8-chaos.test; scenario quota-exhausted |
| `chaosNodeFail` (M8 extension) | full arc now: blackout → Unknown → taints → countdown rings → NodeLost → rebuild elsewhere; meters read street-truth zero | m8-chaos.test; scenario node-notready; `m8-blackout.png` |
| `chaosEtcdSlow` | fsync 500 model-ms; permit-hall queue + courier lag climb | etcd.test; scenario etcd-slow |
| `chaosLeaderFlap` | 4-second elections every 25 model-s steal the pen; vault leader lamp hops; commits stall in bursts while the city keeps serving | etcd.ts flap windows; scenario etcd-slow |
