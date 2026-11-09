import type { MetroDataset } from '../core/types'
import { validateDataset } from '../core/validation'
import type { TestTimetable } from '../maintenance/timetable-types'
import calendarSeed from './china-holidays.json'
import { sha256 } from './sha256'

export type HolidayCalendar = typeof calendarSeed
export interface DataSnapshot {
  format: 'rongxing-data/1'
  version: string
  dataset: MetroDataset
  timetable: TestTimetable
  calendar: HolidayCalendar
}
export interface DataManifest {
  format: 'rongxing-data-manifest/1'
  version: string
  publishedAt: string
  timetableVersion: string
}
export const releaseIdValid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)
export function snapshotDigest(snapshot: DataSnapshot): string { const { version: _, ...payload } = snapshot; return sha256(JSON.stringify(payload)) }
/** Shared by publisher and clients. Unknown contracts fail closed; no guessed references. */
export function validateDataSnapshot(value: unknown): asserts value is DataSnapshot {
  const v = value as DataSnapshot
  if (!v || v.format !== 'rongxing-data/1' || !releaseIdValid(v.version)) throw new Error('不支持的数据版本协议')
  if (validateDataset(v.dataset).length || v.dataset.city.id !== 'fuzhou' || v.dataset.provenance.kind === 'demo') throw new Error('发布线网校验失败')
  const t = v.timetable
  if (!t || t.format !== 'rongxing-test-timetable/1' || t.timezone !== 'Asia/Shanghai' || t.policy !== 'all-source-times-as-test-departures' || typeof t.version !== 'string' || typeof t.notice !== 'string' || !Array.isArray(t.stations) || !Array.isArray(t.trips) || !t.trips.length || t.trips.length > 30000) throw new Error('发布时刻表协议无效')
  const stations = new Set(v.dataset.stations.map(s => s.id)), lines = new Set(v.dataset.lines.map(l => l.id))
  const services = new Map(v.dataset.services.map(s => [s.id, s]))
  const pairs = new Set<string>(), ids = new Set<string>()
  for (const s of t.stations) {
    const key = `${s.lineId}/${s.id}`
    if (!stations.has(s.id) || !lines.has(s.lineId) || pairs.has(key) || !Number.isInteger(s.order) || !services.size || !v.dataset.services.some(p => p.lineId === s.lineId && p.stops.some(x => x.stationId === s.id))) throw new Error('时刻表车站引用或重复错误')
    pairs.add(key)
  }
  for (const trip of t.trips) {
    const service = services.get(trip.serviceId)
    if (!trip.id || ids.has(trip.id) || !service || service.lineId !== trip.lineId || !['local','limited_express','direct_express'].includes(trip.type) || !['all_days','rest_day','workday'].includes(trip.calendar) || typeof trip.quality !== 'string' || !Array.isArray(trip.stops) || trip.stops.length < 2) throw new Error('班次引用或字段错误')
    ids.add(trip.id)
    let previous = -1, seconds = -1
    for (const stop of trip.stops) {
      const index = service.stops.findIndex(s => s.stationId === stop[0])
      if (!Array.isArray(stop) || stop.length !== 2 || !pairs.has(`${trip.lineId}/${stop[0]}`) || index <= previous || !Number.isInteger(stop[1]) || stop[1] <= seconds || stop[1] < 0 || stop[1] > 172800) throw new Error('停站方向、引用或时间错误')
      previous = index; seconds = stop[1]
    }
  }
  const c = v.calendar
  if (!c || c.format !== 'rongxing-cn-service-calendar/1' || c.timezone !== 'Asia/Shanghai' || !Array.isArray(c.years) || !c.years.length) throw new Error('日历协议错误')
  const years = new Set<number>()
  const validDate = (s: unknown, year: number) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && s.startsWith(`${year}-`) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s
  for (const y of c.years) {
    if (!Number.isInteger(y.year) || years.has(y.year) || !y.source?.url?.startsWith('https://') || !Array.isArray(y.holidays) || !Array.isArray(y.makeupWorkdays)) throw new Error('日历年份或来源错误')
    years.add(y.year)
    const days = new Set<string>()
    for (const h of y.holidays) {
      if (!h.name || !validDate(h.start,y.year) || !validDate(h.end,y.year) || h.start > h.end) throw new Error('放假日期错误')
      for (let d = Date.parse(h.start); d <= Date.parse(h.end); d += 86400000) { const key = new Date(d).toISOString().slice(0,10); if (days.has(key)) throw new Error('放假日期重复'); days.add(key) }
    }
    if (new Set(y.makeupWorkdays).size !== y.makeupWorkdays.length || y.makeupWorkdays.some(d => !validDate(d,y.year) || days.has(d))) throw new Error('补班日期错误或冲突')
  }
  if (snapshotDigest(v) !== v.version) throw new Error('数据内容与版本摘要不符')
}
