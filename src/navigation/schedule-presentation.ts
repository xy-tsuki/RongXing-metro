import type { TestTrip } from '../maintenance/timetable-types'
import { chinaDateAt, classifyServiceDate, HOLIDAY_CALENDAR_YEARS } from './service-calendar'
export interface ScheduleEvidence {
  calendar: 'weekend-holiday' | 'workday' | 'daily' | 'mixed'
  accuracy: 'actual' | 'derived' | 'model' | 'mixed' | 'unknown'
}
const weekendLines = new Set(['fz-l1','fz-l2','fz-l4','fz-l5'])
/** Presentation metadata; does not change source quality, calendars or run matching. */
export function tripSchedule(trip: Pick<TestTrip,'lineId'|'type'|'calendar'|'quality'>): ScheduleEvidence {
  const calendar = trip.calendar === 'all_days' ? 'daily' : trip.calendar === 'workday' ? 'workday' : 'weekend-holiday'
  if (trip.lineId === 'fz-f1' && trip.type === 'local' && ['low_model_only', 'video_anchored_overtake_model', 'reverse_pass_model_unverified', 'research_model_v1_2', 'research_model_v1_1'].includes(trip.quality)) return { calendar, accuracy: 'model' }
  if (['research_mixed_v1_2', 'research_mixed_v1_1', 'research_rest_six_v3_1', 'research_l6_v2_1'].includes(trip.quality)) return { calendar, accuracy: 'derived' }
  if (trip.quality === 'research_l1245_v1_0') return { calendar, accuracy: 'derived' }
  if (trip.quality === 'published_source') return { calendar, accuracy: 'actual' }
  if (weekendLines.has(trip.lineId) && trip.quality.includes('estimated_other_stops')) return { calendar, accuracy: 'derived' }
  return { calendar, accuracy: 'unknown' }
}
export function mergeSchedules(items: (ScheduleEvidence | undefined)[]): ScheduleEvidence | undefined {
  if (!items.length || items.some(item => !item)) return undefined
  const known = items as ScheduleEvidence[]
  const calendar = known.every(item => item.calendar === known[0].calendar) ? known[0].calendar : 'mixed'
  const accuracy = known.some(item => item.accuracy === 'unknown') ? 'unknown' : known.every(item => item.accuracy === known[0].accuracy) ? known[0].accuracy : 'mixed'
  return { calendar, accuracy }
}
export function scheduleLabel(value?: ScheduleEvidence, compact = false): string {
  if (!value) return ''
  return ({ actual: '实际时刻', derived: compact ? '含推算' : '运行图 · 含推算', model: compact ? '推算' : '推算时刻', mixed: '含推算', unknown: '精度待核实' })[value.accuracy]
}
export function scheduleScope(lineIds: string[], trips?: TestTrip[]) {
  if (trips) {
    const calendars = new Set(trips.filter(t => lineIds.includes(t.lineId)).map(t=>t.calendar))
    if (!calendars.size) return '未收录时刻'
    if (calendars.size === 1) return ({ all_days:'每日时刻表',workday:'工作日时刻表',rest_day:'周末／节假日时刻表' })[[...calendars][0]]
    return '班次时刻 · 分日期适用'
  }
  if (!lineIds.length) return '班次时刻'
  if (lineIds.every(id => ['fz-f1', 'fz-l6'].includes(id))) return '每日时刻表'
  if (lineIds.every(id => weekendLines.has(id))) return '周末／节假日时刻表'
  return '班次时刻 · 分线路适用'
}
export function calendarGapNote(lineIds: string[], startAt: string, trips?: TestTrip[]) {
  if (trips) {
    const day = classifyServiceDate(chinaDateAt(Date.parse(startAt)))
    const missing = lineIds.filter(id => !trips.some(t => t.lineId === id && (t.calendar === 'all_days' || t.calendar === day.calendar)))
    if (!missing.length) return ''
    if (day.kind === 'unknown') return `${day.date.slice(0,4)}年放假调休日历未收录，暂不匹配非每日班次；不代表实际停运。`
    return `${day.kind === 'makeup-workday'?'该日为调休补班日。':''}所选线路的${day.calendar==='workday'?'工作日':'休息日'}时刻暂缺；前一运营日跨午夜班次仍按原运营日判断。不代表实际停运。`
  }
  if (!lineIds.some(id => weekendLines.has(id))) return ''
  const day = classifyServiceDate(chinaDateAt(Date.parse(startAt)))
  if (day.kind === 'unknown') return `${day.date.slice(0, 4)}年放假调休日历未收录，暂不匹配工作日／节假日班次；不代表实际停运。`
  if (day.kind === 'invalid') return '日期无效，无法匹配班次。'
  return day.calendar === 'workday'
    ? `${day.kind === 'makeup-workday' ? '该日为调休补班日，按工作日匹配。' : ''}1／2／4／5号线工作日时刻暂缺，不套用周末／节假日班次；前一运营日跨午夜班次仍按原运营日判断。不代表实际停运。` : ''
}
export const TIMETABLE_SOURCE_NOTICE = '1／2／4／5号线：周末／节假日研究候选运行图，含站点到发推算，其中1／2号线晚高峰及5号线夜间采用模型修正；未经独立盲测。内置' + HOLIDAY_CALENDAR_YEARS.join('、') + '年国务院放假调休日历：节假日及普通周末匹配休息日运行图，调休补班按工作日；工作日时刻暂缺，不套用休息日班次，未收录年份不猜测日期类型。6号线：每日v2.1研究候选运行图，含站点推算；未经独立盲测。滨海快线：每日v1.1研究候选运行图，普通车为模型推算，快车含公布发车时刻与推算到站值；未经独立盲测。现阶段全部源时刻按发车使用，不提供实时到站。换乘无耗时数据时，站内预设5分钟，闽都—水部及两座三叉街之间站外预设15分钟；预设不代表通路已核实。'


