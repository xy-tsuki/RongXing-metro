import { describe, expect, it } from 'vitest'
import { appendDoor, doorEntries, staircaseGroups } from '../src/maintenance/facility-form'
import { facilityEntryUpdate } from '../src/maintenance/facility-entry'

describe('progressive facility collection form', () => {
  it('only lists registered staircase groups, including an attachment with an unknown door', () => {
    expect(staircaseGroups()).toEqual([])
    expect(staircaseGroups({ '1是否有上行扶梯': '未知' })).toEqual([])
    expect(staircaseGroups({ 楼梯2对应车厢车门: '2:1', '3是否有上行扶梯': '否' })).toEqual([2, 3])
  })
  it('adds two separate numbers without losing existing equivalent positions or changing the submission contract', () => {
    const doors = appendDoor('2车1门', '2', '2')
    expect(doorEntries(doors)).toEqual([{ car: 2, door: 1 }, { car: 2, door: 2 }])
    expect(facilityEntryUpdate({ mode: 'quick', rowKey: 'station-direction', type: '楼梯', doors, group: 2,
      escalator: '是', facilityId: '', nearestExit: '', description: '' }).values).toEqual({ 楼梯2对应车厢车门: '2:1;2:2', '2是否有上行扶梯': '是' })
  })
  it('rejects duplicate, fractional, empty or nonpositive input without assuming a door count', () => {
    expect(() => appendDoor('2:1', '2', '1')).toThrow('已经登记')
    for (const invalid of ['', '0', '-1', '1.5', '2:1']) expect(() => appendDoor('', invalid, '1')).toThrow('整数')
    expect(appendDoor('', '4', '8')).toBe('4:8')
  })
})
