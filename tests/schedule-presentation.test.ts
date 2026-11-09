import { describe, expect, it } from 'vitest'
import { calendarGapNote, mergeSchedules, scheduleLabel, scheduleScope, tripSchedule } from '../src/navigation/schedule-presentation'
import { testTimetable, stationDayDepartures } from '../src/navigation/test-timetable'
describe('timetable provenance, independent from run matching', () => {
  it.each(['fz-l1','fz-l2','fz-l4','fz-l5'])('retains partial stop inference for %s weekend/holiday source diagrams', lineId => {
    const trips=testTimetable.trips.filter(trip=>trip.lineId===lineId)
    expect(trips.length).toBeGreaterThan(0)
    for (const trip of trips) expect(tripSchedule(trip)).toEqual({calendar:'weekend-holiday',accuracy:'derived'})
    expect(scheduleScope([lineId])).toBe('周末／节假日时刻表')
  })
  it('separates daily F1 ordinary inferred runs from published express runs', () => {
    for (const trip of testTimetable.trips.filter(trip=>trip.lineId==='fz-f1')) {
      expect(tripSchedule(trip)).toEqual({calendar:'daily',accuracy:trip.type==='local'?'model':['research_mixed_v1_2','research_mixed_v1_1'].includes(trip.quality)?'derived':'actual'})
    }
    expect(scheduleScope(['fz-f1'])).toBe('每日时刻表')
  })
  it('does not upgrade mixed, derived or unknown quality to actual', () => {
    const actual = tripSchedule({lineId:'fz-f1',type:'direct_express',calendar:'all_days',quality:'published_source'})
    const model = tripSchedule({lineId:'fz-f1',type:'local',calendar:'all_days',quality:'low_model_only'})
    const unknown = tripSchedule({lineId:'fz-f1',type:'direct_express',calendar:'all_days',quality:'unverified'})
    expect(scheduleLabel(actual)).toBe('实际时刻')
    expect(scheduleLabel(model)).toBe('推算时刻')
    expect(scheduleLabel(mergeSchedules([actual,model]),true)).toBe('含推算')
    expect(mergeSchedules([actual,unknown])?.accuracy).toBe('unknown')
    expect(mergeSchedules([actual,undefined])).toBeUndefined()
  })
  it('explains actual workday gaps and distinguishes holiday and makeup workdays', () => {
    expect(calendarGapNote(['fz-l1'],'2026-10-19T08:00:00+08:00')).toContain('工作日时刻暂缺')
    expect(calendarGapNote(['fz-l1'],'2026-10-10T08:00:00+08:00')).toContain('调休补班')
    expect(calendarGapNote(['fz-l1'],'2026-10-01T08:00:00+08:00')).toBe('')
    expect(calendarGapNote(['fz-l1'],'2027-01-02T08:00:00+08:00')).toContain('未收录')
    expect(calendarGapNote(['fz-l1'],'2026-10-17T08:00:00+08:00')).toBe('')
    expect(calendarGapNote(['fz-f1'],'2026-10-19T08:00:00+08:00')).toBe('')
  })
  it('exposes the source label for actual station rows and retains raw quality', () => {
    const trip=testTimetable.trips.find(trip=>trip.lineId==='fz-f1'&&trip.type==='limited_express')!
    const row=stationDayDepartures(trip.stops[0][0],trip.serviceId,'2026-10-19').find(row=>row.tripId===trip.id)!
    expect(row.quality).toBe('research_mixed_v1_1')
    expect(scheduleLabel(row.schedule)).toContain('含推算')
  })
  it('keeps L6 daily candidate timing derived, including workdays', () => {
    const trips = testTimetable.trips.filter(t => t.lineId === 'fz-l6')
    expect(trips.length).toBe(254)
    expect(trips.every(t => tripSchedule(t).accuracy === 'derived')).toBe(true)
    expect(scheduleScope(['fz-l6'])).toBe('每日时刻表')
    expect(scheduleScope(['fz-f1','fz-l6'])).toBe('每日时刻表')
    expect(calendarGapNote(['fz-l6'],'2026-10-19T08:00:00+08:00')).toBe('')
  })
})
