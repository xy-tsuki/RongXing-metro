import { describe, expect, it } from 'vitest'
import { getStationFare, getStationFareDatabase } from '../src/core/fare'

describe('Fuzhou station fare dataset', () => {
  it('contains every unordered pair in the current operating network', () => {
    const database = getStationFareDatabase()
    expect(database.stationCount).toBe(102)
    expect(database.unorderedPairCount).toBe((102 * 101) / 2)
    expect(database.pairs).toHaveLength(database.unorderedPairCount)
  })

  it('matches the official Binhai Express example fares', () => {
    expect(getStationFare('fz-福州火车站', 'fz-帝封江')?.fareYuan).toBe(4)
    expect(getStationFare('fz-福州火车站', 'fz-机场')?.fareYuan).toBe(17)
    expect(getStationFare('fz-福州火车站', 'fz-文岭')?.fareYuan).toBe(18)
  })

  it('does not turn the two out-of-station links into direct transfer edges', () => {
    const sanchajie = getStationFare('fz-三叉街', 'fz-三叉街-滨海快线')
    const shuibu = getStationFare('fz-水部', 'fz-闽都')
    expect(sanchajie?.routeStationIds.length).toBeGreaterThan(2)
    expect(shuibu?.routeStationIds.length).toBeGreaterThan(2)
    expect(sanchajie?.routeLineIds).toContain('fz-l4')
    expect(shuibu?.routeLineIds).toContain('fz-l1')
  })

  it('returns a reversible quote and does not claim a fare for a same-station trip', () => {
    const outward = getStationFare('fz-福州火车站', 'fz-机场')
    const reverse = getStationFare('fz-机场', 'fz-福州火车站')
    expect(outward?.fareYuan).toBe(reverse?.fareYuan)
    expect(reverse?.routeStationIds).toEqual([...outward!.routeStationIds].reverse())
    expect(getStationFare('fz-机场', 'fz-机场')).toBeNull()
  })
})
