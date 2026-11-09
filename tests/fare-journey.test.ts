import { describe, expect, it, vi } from 'vitest'
import { calculateFareJourney, type FareLookupQuote } from '../src/core/fare-journey'

const quote = (fareYuan: number): FareLookupQuote => ({
  fareYuan,
  mainAreaFareYuan: fareYuan,
  newDistrictFareYuan: 0
})

describe('fare journey boundaries', () => {
  it('uses the origin-destination pair for a continuous paid-area trip', () => {
    const lookup = vi.fn(() => quote(5))
    const result = calculateFareJourney({ originStationId: 'A', destinationStationId: 'D', lookup })
    expect(lookup.mock.calls).toEqual([['A', 'D']])
    expect(result).toMatchObject({ status: 'complete', totalFareYuan: 5, segments: [{ fromStationId: 'A', toStationId: 'D' }] })
  })

  it('splits at ordered out-of-station transfers and sums each paid-area journey', () => {
    const calls: Array<[string, string]> = []
    const fares: Record<string, number> = { 'A:B': 3, 'C:D': 4, 'E:F': 5 }
    const result = calculateFareJourney({
      originStationId: 'A',
      destinationStationId: 'F',
      externalTransfers: [{ fromStationId: 'B', toStationId: 'C' }, { fromStationId: 'D', toStationId: 'E' }],
      lookup: (from, to) => {
        calls.push([from, to])
        const fare = fares[`${from}:${to}`]
        return fare === undefined ? null : quote(fare)
      }
    })
    expect(calls).toEqual([['A', 'B'], ['C', 'D'], ['E', 'F']])
    expect(result.status).toBe('complete')
    expect(result.totalFareYuan).toBe(12)
    expect(result.segments.map(segment => [segment.fromStationId, segment.toStationId])).toEqual([['A', 'B'], ['C', 'D'], ['E', 'F']])
  })

  it('accepts the first and last paid ride stations, excluding access and egress walks', () => {
    const lookup = vi.fn(() => quote(6))
    const result = calculateFareJourney({
      // The caller derives these from route.legs[0] and route.legs.at(-1).
      originStationId: 'entry',
      destinationStationId: 'exit',
      lookup
    })
    expect(lookup.mock.calls).toEqual([['entry', 'exit']])
    expect(result.totalFareYuan).toBe(6)
  })

  it('charges the confirmed two-yuan minimum for same-station entry and exit', () => {
    const lookup = vi.fn(() => null)
    const result = calculateFareJourney({ originStationId: 'A', destinationStationId: 'A', lookup })
    expect(result).toMatchObject({ status: 'complete', totalFareYuan: 2 })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('withholds the total if any paid-area section has no verified fare row', () => {
    const result = calculateFareJourney({
      originStationId: 'A',
      destinationStationId: 'D',
      externalTransfers: [{ fromStationId: 'B', toStationId: 'C' }],
      lookup: (from, to) => from === 'A' && to === 'B' ? quote(3) : null
    })
    expect(result).toMatchObject({ status: 'incomplete', totalFareYuan: null })
    expect(result.segments.map(segment => segment.fareYuan)).toEqual([3, null])
    expect(result.issues).toHaveLength(1)
  })

  it('rejects an invalid out-of-station transfer boundary', () => {
    const result = calculateFareJourney({
      originStationId: 'A',
      destinationStationId: 'D',
      externalTransfers: [{ fromStationId: 'B', toStationId: 'B' }],
      lookup: () => quote(4)
    })
    expect(result).toMatchObject({ status: 'invalid', totalFareYuan: null, segments: [] })
  })
})
