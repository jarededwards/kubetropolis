import { describe, expect, it } from 'vitest'

import { DESTINATIONS, destinationForDistrict, destinationForId } from './destinations'

describe('canonical destinations', () => {
  it('names each navigable district exactly once', () => {
    expect(DESTINATIONS).toHaveLength(8)
    expect(new Set(DESTINATIONS.map((destination) => destination.district)).size).toBe(8)
    expect(new Set(DESTINATIONS.map((destination) => destination.id)).size).toBe(8)

    for (const destination of DESTINATIONS) {
      expect(destinationForDistrict(destination.district)).toBe(destination)
      expect(destinationForId(destination.id)).toBe(destination)
    }
  })

  it('names the vault for what it is', () => {
    expect(destinationForDistrict('records')?.name).toBe('Hall of Records (etcd)')
  })
})
