import { describe, expect, it } from 'vitest'
import { appendExit, collectionDate, exitEntries } from '../src/maintenance/collection-fields'
import { facilityEntryUpdate } from '../src/maintenance/facility-entry'

describe('collection date and incremental exit entry', () => {
  it('uses the local calendar day at both ends of the day and pads month/day', () => {
    expect(collectionDate(new Date(2026, 9, 20, 0, 1))).toBe('2026-10-20')
    expect(collectionDate(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02')
  })
  it('adds exits individually while retaining the existing facility text contract', () => {
    const exits = appendExit(appendExit('', ' A口 '), 'B口')
    expect(exitEntries(exits)).toEqual(['A口', 'B口'])
    const update = facilityEntryUpdate({ mode: 'detail', rowKey: 'station-direction', type: '楼梯', group: 1,
      doors: '', escalator: '未知', facilityId: '楼梯1', nearestExit: exits, description: '' })
    expect(update.values.最近出入口).toBe('A口、B口')
    expect(exitEntries('站厅东侧 A出口')).toEqual(['站厅东侧 A出口'])
  })
  it('rejects blank, duplicate, bulk or oversized entries without rewriting the existing list', () => {
    for (const value of ['', ' a口 ', 'B口、C口']) expect(() => appendExit('A口', value)).toThrow()
    expect(() => appendExit('A'.repeat(299), 'B口')).toThrow('过长')
    expect(exitEntries('')).toEqual([])
  })
})
