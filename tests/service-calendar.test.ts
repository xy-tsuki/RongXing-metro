import { describe, it, expect } from 'vitest'
import data from '../src/data/china-holidays.json'
import { calendarServesDate, chinaDateAt, classifyServiceDate, serviceDayLabel, validServiceDate } from '../src/navigation/service-calendar'

describe('mainland China published holiday and adjusted-workday calendar', () => {
  it.each([
    ['2025-01-01', 'holiday', 'rest_day'], ['2025-02-04', 'holiday', 'rest_day'],
    ['2025-01-26', 'makeup-workday', 'workday'], ['2025-02-08', 'makeup-workday', 'workday'],
    ['2025-04-27', 'makeup-workday', 'workday'], ['2025-09-28', 'makeup-workday', 'workday'],
    ['2025-10-08', 'holiday', 'rest_day'], ['2025-10-11', 'makeup-workday', 'workday'],
    ['2026-01-01', 'holiday', 'rest_day'], ['2026-01-04', 'makeup-workday', 'workday'],
    ['2026-02-14', 'makeup-workday', 'workday'], ['2026-02-15', 'holiday', 'rest_day'],
    ['2026-02-23', 'holiday', 'rest_day'], ['2026-02-24', 'weekday', 'workday'],
    ['2026-02-28', 'makeup-workday', 'workday'], ['2026-04-06', 'holiday', 'rest_day'],
    ['2026-05-05', 'holiday', 'rest_day'], ['2026-05-09', 'makeup-workday', 'workday'],
    ['2026-06-19', 'holiday', 'rest_day'], ['2026-09-20', 'makeup-workday', 'workday'],
    ['2026-09-25', 'holiday', 'rest_day'], ['2026-10-07', 'holiday', 'rest_day'],
    ['2026-10-08', 'weekday', 'workday'], ['2026-10-10', 'makeup-workday', 'workday'],
    ['2026-10-17', 'weekend', 'rest_day'], ['2026-10-19', 'weekday', 'workday'],
  ])('%s is %s rather than merely weekday/weekend', (date, kind, calendar) => {
    expect(classifyServiceDate(date)).toMatchObject({ kind, calendar })
    expect(calendarServesDate('rest_day', date)).toBe(calendar === 'rest_day')
    expect(calendarServesDate('workday', date)).toBe(calendar === 'workday')
    expect(calendarServesDate('all_days', date)).toBe(true)
  })
  it('checks full-year coverage against published arranged-day totals and keeps sources auditable', () => {
    for (const [year, holidayCount, makeupCount] of [[2025, 28, 5], [2026, 33, 6]]) {
      const records = data.years.find(item => item.year === year)!
      const holidayDates = records.holidays.flatMap(item => {
        const dates: string[] = []
        for (let day = Date.parse(`${item.start}T00:00:00Z`); day <= Date.parse(`${item.end}T00:00:00Z`); day += 86400000) dates.push(new Date(day).toISOString().slice(0, 10))
        return dates
      })
      expect(holidayDates.length).toBe(holidayCount)
      expect(new Set(holidayDates).size).toBe(holidayCount)
      expect(new Set(records.makeupWorkdays).size).toBe(makeupCount)
      expect(records.makeupWorkdays.some(date => holidayDates.includes(date))).toBe(false)
      expect(new URL(records.source.url).hostname).toMatch(/\.gov\.cn$/)
      expect([...holidayDates, ...records.makeupWorkdays].every(date => validServiceDate(date) && date.startsWith(`${year}-`))).toBe(true)
      for (let day = Date.UTC(year, 0, 1); day < Date.UTC(year + 1, 0, 1); day += 86400000) expect(classifyServiceDate(new Date(day).toISOString().slice(0, 10)).calendar).not.toBeNull()
    }
  })
  it('does not guess dates outside embedded years or silently normalize invalid dates', () => {
    expect(classifyServiceDate('2027-01-02').kind).toBe('unknown')
    expect(calendarServesDate('rest_day', '2027-01-02')).toBe(false)
    expect(calendarServesDate('workday', '2027-01-02')).toBe(false)
    expect(calendarServesDate('all_days', '2027-01-02')).toBe(true)
    for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '', '2026-1-1']) {
      expect(classifyServiceDate(date).kind).toBe('invalid')
      expect(calendarServesDate('all_days', date)).toBe(false)
    }
    expect(serviceDayLabel('2026-10-10')).toContain('调休补班')
    expect(serviceDayLabel('2026-10-01')).toContain('国庆节')
    expect(serviceDayLabel('2027-01-02')).toContain('未收录')
  })
  it('uses China midnight independently of client timezone', () => {
    expect(chinaDateAt(Date.parse('2026-09-30T15:59:59Z'))).toBe('2026-09-30')
    expect(chinaDateAt(Date.parse('2026-09-30T16:00:00Z'))).toBe('2026-10-01')
    expect(chinaDateAt(Date.parse('2026-10-01T00:00:00+09:00'))).toBe('2026-09-30')
    expect(chinaDateAt(NaN)).toBe('')
  })
})
