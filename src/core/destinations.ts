/* Derived from PGSimCity src/core/destinations.ts @ 6d2c854 (Apache-2.0,
 * © 2026 Nikolay Samokhvalov). Modified for Kubetropolis: the eight
 * navigable places are the Kubernetes city's districts. */
import type { DistrictId } from './types'

export interface Destination {
  district: Exclude<DistrictId, 'world'>
  id: string
  name: string
  /** Obvious abbreviation for the 196 px minimap only. */
  shortName: string
}

/**
 * The eight places a visitor can navigate to.
 *
 * View controls, help, floating map labels, ground wayfinding, the minimap and
 * destination inspector headings all read this table. Component names remain
 * free to name the specific building at the destination.
 */
export const DESTINATIONS: readonly Destination[] = [
  { district: 'gate', id: 'client.terminal', name: 'Client terminal', shortName: 'kubectl' },
  { district: 'civic', id: 'cityhall.permitdesk', name: 'City Hall (kube-apiserver)', shortName: 'City Hall' },
  { district: 'records', id: 'records.vault', name: 'Hall of Records (etcd)', shortName: 'etcd' },
  { district: 'zoning', id: 'zoning.maptable', name: 'Zoning Office (kube-scheduler)', shortName: 'Zoning' },
  { district: 'inspectors', id: 'inspectors.office', name: 'Office of Inspectors (controllers)', shortName: 'Inspectors' },
  { district: 'node-b', id: 'node.b.foreman', name: 'Node districts (kubelets)', shortName: 'Nodes' },
  { district: 'harbor', id: 'harbor.crane', name: 'Harbor (image registry)', shortName: 'Harbor' },
  { district: 'ingress', id: 'service.junction', name: 'Service junction', shortName: 'Services' },
] as const

const BY_DISTRICT = new Map<DistrictId, Destination>(
  DESTINATIONS.map((destination) => [destination.district, destination]),
)
const BY_ID = new Map(DESTINATIONS.map((destination) => [destination.id, destination]))

export function destinationForDistrict(district: DistrictId): Destination | undefined {
  return BY_DISTRICT.get(district)
}

export function destinationForId(id: string): Destination | undefined {
  return BY_ID.get(id)
}
