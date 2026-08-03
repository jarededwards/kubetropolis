/* Kubetropolis sim — the lighthouse operator (the shack on the dock).
 *
 * An operator is an ordinary client: a controller process holding a watch on
 * a custom kind and reconciling it (claims: crd.operator). This desk runs
 * ONLY while state.operatorRunning — that gate is the entire M7 lesson. Its
 * street actions touch the physical beacon (SimState.beacon) the way the
 * kubelet touches containers: it is the device's controller. Everything it
 * tells the cluster goes through the API as status writes, bucketed so the
 * vault is not spammed.
 *
 * The physics (stepBeacon) run every tick regardless: fuel does not care
 * whether anyone is watching. That asymmetry — drift is free, correction
 * needs a running process — is why operators exist.
 */

import { CLAIM_VALUES } from '../../core/claims'
import type { LighthouseObj, SimState, Uid } from '../../core/types'
import { submit } from '../apiserver'
import { clone, pushEvent } from '../objects'

const LH = CLAIM_VALUES.modelLighthouse

/**
 * The keeper looks at his lamp: while staffed, the operator sweeps its DEVICE
 * on a short cadence (the controller-runtime RequeueAfter idiom) — that is
 * how construction completion, the fuel gauge, and truck arrivals are
 * noticed without spamming the vault. Sim-internal cadence, not reader copy.
 */
export const DEVICE_SWEEP_SECONDS = 2

/** Street truth → published status, in buckets (no write amplification). */
function bucket(pct: number): number {
  return Math.max(0, Math.round(pct / LH.statusBucketPct) * LH.statusBucketPct)
}

export function reconcileLighthouse(state: SimState, uid: Uid): void {
  const obj = state.etcd.objects.get(uid)
  if (obj?.kind !== 'Lighthouse') return
  const cr = obj as LighthouseObj

  // First look at a new law's first permit: file the construction.
  if (!state.beacon || state.beacon.uid !== cr.uid) {
    state.beacon = {
      uid: cr.uid,
      buildingUntil: state.now + LH.buildSeconds,
      built: false,
      lit: false,
      fuelPct: 100,
      beamRpm: cr.spec.beamRpm,
    }
    state.flowOutbox.push({ route: 'workorder.inspect', kind: 'workOrder' })
    pushEvent(state, 'Normal', 'Constructing', cr.name, 'the operator files the build — the tower rises on the breakwater')
    return
  }

  const beacon = state.beacon
  beacon.beamRpm = cr.spec.beamRpm

  if (!beacon.built) return // construction still under way; physics will flip it

  // Not lit and there is fuel: ignite.
  if (!beacon.lit && beacon.fuelPct > 0) {
    beacon.lit = true
    pushEvent(state, 'Normal', 'Ignited', cr.name, `beacon lit — sweeping at ${cr.spec.beamRpm} rpm`)
  }

  // Fuel low and no truck on the road: dispatch a refuel run. Fuel restores
  // on ARRIVAL — the road takes real model time.
  if (beacon.fuelPct < LH.refuelBelowPct && beacon.refuelArriveAt === undefined) {
    beacon.refuelArriveAt = state.now + LH.refuelTravelSeconds
    state.flowOutbox.push({ route: 'refuel', kind: 'imagePull' })
    pushEvent(state, 'Normal', 'RefuelDispatched', cr.name, `fuel ${beacon.fuelPct.toFixed(0)}% — a truck leaves the docks`)
  }

  if (beacon.refuelArriveAt !== undefined && state.now >= beacon.refuelArriveAt) {
    beacon.refuelArriveAt = undefined
    beacon.fuelPct = 100
    if (!beacon.lit) beacon.lit = true
    pushEvent(state, 'Normal', 'Refueled', cr.name, 'fuel restored to 100% — maintenance stamped')
    publishStatus(state, cr, beacon.lit, beacon.fuelPct, state.now)
    return
  }

  // Publish only when the bucketed truth differs from the ledger.
  if (cr.status.lit !== beacon.lit || bucket(cr.status.fuelPct) !== bucket(beacon.fuelPct)) {
    publishStatus(state, cr, beacon.lit, beacon.fuelPct, cr.status.lastMaintainedAt)
  }
}

function publishStatus(
  state: SimState,
  cr: LighthouseObj,
  lit: boolean,
  fuelPct: number,
  lastMaintainedAt: number | undefined,
): void {
  const next = clone(cr)
  next.status.lit = lit
  next.status.fuelPct = bucket(fuelPct)
  if (lastMaintainedAt !== undefined) next.status.lastMaintainedAt = lastMaintainedAt
  submit(state, 'updateStatus', next, 'operator')
}

/**
 * Physics — every tick, staffed or not. Construction completes, fuel drains
 * while lit, and the beacon goes dark at zero. Nothing here writes to the
 * vault: the street does not file paperwork about itself.
 */
export function stepBeacon(state: SimState, dt: number): void {
  const beacon = state.beacon
  if (!beacon) return

  if (!beacon.built && state.now >= beacon.buildingUntil) {
    beacon.built = true
  }

  if (beacon.lit) {
    beacon.fuelPct = Math.max(0, beacon.fuelPct - LH.fuelDecayPctPerSec * dt)
    if (beacon.fuelPct <= 0 && beacon.lit) {
      beacon.lit = false
      pushEvent(state, 'Warning', 'BeaconDark', 'harbor-light', 'fuel exhausted — the breakwater goes dark')
    }
  }
}
