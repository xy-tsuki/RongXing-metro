import calendarSeed from '../data/china-holidays.json'
import type { HolidayCalendar } from '../data/release-contract'
let calendar: HolidayCalendar = calendarSeed
export function setServiceCalendar(value: HolidayCalendar) {
  calendar = value
  HOLIDAY_CALENDAR_YEARS.splice(0,HOLIDAY_CALENDAR_YEARS.length,...value.years.map(y=>y.year))
}

export type ServiceCalendar = 'rest_day' | 'workday' | 'all_days'
export interface ServiceDay {
  date: string
  kind: 'holiday' | 'makeup-workday' | 'weekend' | 'weekday' | 'unknown' | 'invalid'
  calendar: 'rest_day' | 'workday' | null
  holidayName?: string
  sourceUrl?: string
}
export const HOLIDAY_CALENDAR_YEARS = calendarSeed.years.map(item => item.year)
const DAY = 86400_000, OFFSET = 480 * 60_000
export function validServiceDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const value = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date
}
/** Inclusive State Council holiday arrangements; these are not all statutory-only holiday dates. */
export function classifyServiceDate(date: string): ServiceDay {
  if (!validServiceDate(date)) return { date, kind: 'invalid', calendar: null }
  const year = calendar.years.find(item => item.year === Number(date.slice(0, 4)))
  if (!year) return { date, kind: 'unknown', calendar: null }
  const sourceUrl = year.source.url
  if (year.makeupWorkdays.includes(date)) return { date, kind: 'makeup-workday', calendar: 'workday', sourceUrl }
  const holiday = year.holidays.find(item => date >= item.start && date <= item.end)
  if (holiday) return { date, kind: 'holiday', calendar: 'rest_day', holidayName: holiday.name, sourceUrl }
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return { date, kind: day === 0 || day === 6 ? 'weekend' : 'weekday', calendar: day === 0 || day === 6 ? 'rest_day' : 'workday', sourceUrl }
}
/** China civil date, independent of the device timezone (including UTC and Japan). */
export function chinaDateAt(instant: number): string {
  const date = new Date(Math.floor((instant + OFFSET) / DAY) * DAY)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}
export function calendarServesDate(type: ServiceCalendar, date: string): boolean {
  if (!validServiceDate(date)) return false
  return type === 'all_days' || classifyServiceDate(date).calendar === type
}
export function serviceDayLabel(date: string): string {
  const day = classifyServiceDate(date)
  if (day.kind === 'invalid') return '日期无效'
  if (day.kind === 'unknown') return `${date.slice(0, 4)}年放假调休日历未收录，日期类型待确认`
  if (day.kind === 'holiday') return `${day.holidayName}放假调休 · 节假日`
  if (day.kind === 'makeup-workday') return '调休补班日 · 工作日'
  return day.kind === 'weekend' ? '普通周末 · 休息日' : '普通工作日'
}
