import { describe, expect, it } from 'vitest'
import { fuzhouDataset } from '../src/data/fuzhou'
import { planJourney } from '../src/core'
import { departureWindow, displayCandidates } from '../src/navigation/departures'
import { testTimetable, timetableDepartures, stationDayDepartures, serviceClock, hasTimetableCoverage } from '../src/navigation/test-timetable'
import type { TestTiming } from '../src/navigation/test-timetable'

const routes = (from: string, to: string) => planJourney(fuzhouDataset, { from: fuzhouDataset.stations.find(s => s.name === from)!.id, to: fuzhouDataset.stations.find(s => s.name === to)!.id, mode: 'shortest' }).routes
describe('六线测试时刻全量供应', () => {
  it('全量1785班34808停站均可按站和方向访问，包括研究模型及补推', () => {
    expect(testTimetable.trips).toHaveLength(1785)
    expect(testTimetable.trips.reduce((sum, trip) => sum + trip.stops.length, 0)).toBe(34808)
    let total = 0
    for (const station of testTimetable.stations) for (const service of fuzhouDataset.services.filter(s => s.lineId === station.lineId)) total += stationDayDepartures(station.id, service.id, '2026-10-17').length
    expect(total).toBe(34808)
    expect(testTimetable.trips.filter(t => t.lineId === 'fz-f1' && t.type === 'local')).toHaveLength(263)
    expect(testTimetable.stations.find(s => s.lineId === 'fz-f1' && s.name.includes('三叉街'))!.id).toBe('fz-三叉街-滨海快线')
  })
  it('研究候选保留发车而非到站时刻，快车通过事件不允许上下车', () => {
    const local = testTimetable.trips.find(t => t.id === 'F1-SYNTH-to_wenling-07-00')!
    expect(local.stops.find(s => s[0] === 'fz-东门')?.[1]).toBe(7 * 3600 + 7 * 60)
    const shouzhan = stationDayDepartures('fz-首占', local.serviceId, '2026-10-17')
    expect(shouzhan.every(row => row.type === 'local')).toBe(true)
    expect(shouzhan.some(row => row.tripId === local.id)).toBe(true)
  })
  it.each([
    ['FZ-L1-to_sanjiangkou-098', 'fz-东街口', 61920],
    ['FZ-L2-to_yangli-103', 'fz-南门兜', 63540],
  ])('晚高峰H1班次%s按修正发车秒数供应', (tripId, stationId, seconds) => {
    const trip = testTimetable.trips.find(t => t.id === tripId)!
    expect(trip.quality).toBe('research_rest_six_v3_1')
    expect(trip.stops.find(stop => stop[0] === stationId)?.[1]).toBe(seconds)
    const row = stationDayDepartures(stationId, trip.serviceId, '2026-10-17').find(row => row.tripId === tripId)!
    expect(row.seconds).toBe(seconds)
  })
  it('同一路线返回多班次，明确普通与快车，并按实际停站给出计数', () => {
    const paths = routes('福州火车站', '机场'), window = departureWindow('2026-10-17T08:00:00+08:00')
    const runs = timetableDepartures(paths, window)
    expect(runs.length).toBeGreaterThan(2)
    expect(new Set(runs.map(r => r.id)).size).toBe(runs.length)
    expect(runs.some(r => r.timing.legs![0].serviceClass === 'limited-express')).toBe(true)
    for (const run of runs) {
      const first = run.timing.legs![0] as TestTiming
      expect(first.testRun).toBe(true)
      expect(run.routeOverride.legs[0].stopCount).toBe(first.stopStationIds!.length - 1)
      expect(Date.parse(run.timing.route!.departureAt!)).toBeGreaterThanOrEqual(Date.parse(window.startAt))
    }
    expect(displayCandidates(paths, runs, window, true).every(r => r.route === r.routeOverride)).toBe(true)
  })
  it('快车不停的站不会出现该快车的发车，不杜撰快车停站', () => {
    const runs = timetableDepartures(routes('闽都', '机场'), departureWindow('2026-10-17T08:00:00+08:00'))
    expect(runs.length).toBeGreaterThan(0)
    expect(runs.every(r => r.timing.legs![0].serviceClass === 'local')).toBe(true)
  })
  it('保留休息日范围；工作日不套用休息日班次，跨午夜保留前一运营日', () => {
    expect(stationDayDepartures('fz-象峰', 'fz-l1-forward', '2026-10-19')).toHaveLength(0)
    const late = testTimetable.trips.find(t => t.calendar === 'rest_day' && t.stops.some(s => s[1] > 86400))!
    const stop = late.stops.find(s => s[1] > 86400)!
    expect(serviceClock(stop[1]).startsWith('24:')).toBe(true)
    expect(stationDayDepartures(stop[0], late.serviceId, '2026-10-17').some(r => r.tripId === late.id)).toBe(true)
    const paths = routes('洪塘', '半洲')
    const overnight = timetableDepartures(paths, departureWindow('2026-10-18T00:05:00+08:00'))
    expect(overnight.length).toBeGreaterThan(0)
    expect(overnight.some(r => r.id.includes('FZ-L4'))).toBe(true)
  })
  it('节假日周四有休息日班次，补班周六不套用；每日滨海班次不受影响', () => {
    const ordinary = stationDayDepartures('fz-象峰', 'fz-l1-forward', '2026-10-17')
    expect(stationDayDepartures('fz-象峰', 'fz-l1-forward', '2026-10-01').map(row => row.seconds)).toEqual(ordinary.map(row => row.seconds))
    expect(stationDayDepartures('fz-象峰', 'fz-l1-forward', '2026-10-10')).toHaveLength(0)
    expect(stationDayDepartures('fz-象峰', 'fz-l1-forward', '2027-01-02')).toHaveLength(0)
    const daily = testTimetable.trips.find(trip => trip.lineId === 'fz-f1')!
    const count = (date: string) => stationDayDepartures(daily.stops[0][0], daily.serviceId, date).length
    expect(count('2026-10-01')).toBe(count('2026-10-10'))
    expect(count('2027-01-02')).toBeGreaterThan(0)
  })
  it('假期最后一日24点后的班次保留假期运营日；补班日跨午夜不冒用休息日车次', () => {
    const paths = routes('洪塘', '半洲')
    expect(timetableDepartures(paths, departureWindow('2026-10-08T00:05:00+08:00')).length).toBeGreaterThan(0)
    expect(timetableDepartures(paths, departureWindow('2026-10-11T00:05:00+08:00'))).toHaveLength(0)
  })
  it('工作日运行图具备独立匹配能力，但不为现库生成不存在的工作日班次', () => {
    const original = testTimetable.trips.find(t => t.lineId === 'fz-l1')!
    const synthetic = { ...testTimetable, trips: [{ ...original, id: 'synthetic-workday-only', calendar: 'workday' as const }] }
    const rows = (date: string) => stationDayDepartures(original.stops[0][0], original.serviceId, date, synthetic)
    expect(rows('2026-10-10')).toHaveLength(1)
    expect(rows('2026-10-19')).toHaveLength(1)
    expect(rows('2026-10-01')).toHaveLength(0)
    expect(rows('2026-10-17')).toHaveLength(0)
    expect(testTimetable.trips.some(t => t.calendar === 'workday')).toBe(false)
  })
  it('六号线已含每日班次；换乘未知不伪造步行与候车测量', () => {
    expect(hasTimetableCoverage(routes('营前', '万寿'))).toBe(true)
    expect(stationDayDepartures('fz-潘墩', 'fz-l6-forward', '2026-10-19')).toHaveLength(127)
    expect(testTimetable.trips.filter(t => t.lineId === 'fz-l6')).toHaveLength(254)
    const paths = routes('南门兜', '机场'), runs = timetableDepartures(paths, departureWindow('2026-10-17T08:00:00+08:00'))
    expect(runs.some(r => Object.keys(r.timing.transfers ?? {}).length > 0)).toBe(true)
    for (const run of runs) for (const [index, value] of Object.entries(run.timing.transfers ?? {})) {
      const allowance = paths.find(path => path.id === run.routeId)!.transfers[Number(index)].kind === 'external' ? 10 : 3
      expect((value as TestTiming).transferFeasibility).toBe('unknown')
      expect(value.walkingMinutes).toBeUndefined()
      expect(value.waitingMinutes).toBeUndefined()
      expect((value as TestTiming).testAllowanceMinutes).toBe(allowance)
      expect(Date.parse(value.arrivalAt!) - Date.parse(value.departureAt!)).toBeGreaterThanOrEqual(allowance * 60_000)
    }
  })
  it('五号线夜间新模型按本包发车秒数供应，原始分钟精度不提升为实测', () => {
    const trip = testTimetable.trips.find(t => t.id === 'L5-rest_day-to_jingxi-fused-127')!
    expect(trip.stops.find(s => s[0] === 'fz-吴山')?.[1]).toBe(80580)
    expect(trip.quality).toBe('research_rest_six_v3_1')
  })
  it.each([
    ['南门兜', '机场', 'fz-水部', 'fz-闽都'],
    ['机场', '南门兜', 'fz-闽都', 'fz-水部'],
    ['上藤', '首占', 'fz-三叉街', 'fz-三叉街-滨海快线'],
    ['首占', '上藤', 'fz-三叉街-滨海快线', 'fz-三叉街'],
  ])('站外衔接%s至%s按最短路线10分钟预设选后续班次', (from, to, fromStationId, toStationId) => {
    const paths = routes(from, to).filter(route => route.transfers.some(guide => guide.fromStationId === fromStationId && guide.toStationId === toStationId))
    expect(paths.length).toBeGreaterThan(0)
    const runs = timetableDepartures(paths, departureWindow('2026-10-17T08:00:00+08:00'))
    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) {
      const index = paths.find(path => path.id === run.routeId)!.transfers.findIndex(guide => guide.fromStationId === fromStationId && guide.toStationId === toStationId)
      const value = run.timing.transfers![index] as TestTiming
      expect(value.testAllowanceMinutes).toBe(10)
      expect(Date.parse(value.arrivalAt!) - Date.parse(value.departureAt!)).toBeGreaterThanOrEqual(10 * 60_000)
      expect(value.walkingMinutes).toBeUndefined()
      expect(value.waitingMinutes).toBeUndefined()
    }
  })
})
