import { describe, expect, it } from 'vitest'
import type { JourneyRoute } from '../src/core/types'
import type { TestTimetable, TestTrip } from '../src/maintenance/timetable-types'
import { departureWindow, displayCandidates } from '../src/navigation/departures'
import { timetableDepartures, queryTimetable } from '../src/navigation/test-timetable'
import { usefulDepartures } from '../src/navigation/departure-selection'

const clock = (s: string) => s.split(':').reduce((n, v) => n * 60 + Number(v), 0) * 60
const at = (s: string) => `2026-10-17T${s}:00+08:00`
function route(id = 'r', count = 2): JourneyRoute {
  return { id, legs: Array.from({ length: count }, (_, i) => ({ serviceId: `s${i}`, lineId: `l${i}`, lineName: `l${i}`, lineColor: '#112233', direction: '终点', fromStationId: `n${i}`, fromStationName: `n${i}`, toStationId: `n${i+1}`, toStationName: `n${i+1}`, stopCount: 1, rideMinutes: null, recommendations: [], recommendationStatus: 'pending', recommendationBasis: [] })),
    transfers: Array.from({ length: count - 1 }, (_, i) => ({ stationId: `n${i+1}`, stationName: '换乘', fromLineName: `l${i}`, toLineName: `l${i+1}`, path: null, instructions: [] })),
    originPath: null, destinationPath: null, doorCombinations: [], walkingMetres: null, stairCount: null, rideMinutes: null, totalMinutes: null, transferCount: count-1, confidence: 'topology-only', granularity: 'basic', equalChoicesTruncated: false }
}
function trip(id: string, leg: number, from: string, to: string): TestTrip {
  return { id, lineId: `l${leg}`, serviceId: `s${leg}`, type: 'local', calendar: 'all_days', quality: 'synthetic', stops: [[`n${leg}`, clock(from)], [`n${leg+1}`, clock(to)]] }
}
const bundle = (...trips: TestTrip[]): TestTimetable => ({ format: 'rongxing-test-timetable/1', version: 'synthetic', timezone: 'Asia/Shanghai', policy: 'all-source-times-as-test-departures', notice: '合成测试', stations: [], trips })

describe('bounded timetable connections', () => {
  it('rejects 00:16 → 06:31 overnight waiting, but permits a short connection across midnight', () => {
    const paths = [route()]
    expect(timetableDepartures(paths, departureWindow(at('00:00')), bundle(trip('a',0,'00:05','00:16'),trip('b',1,'06:31','06:50')))).toEqual([])
    const runs = timetableDepartures(paths, departureWindow(at('23:40')), bundle(trip('a',0,'23:50','24:05'),trip('b',1,'24:10','24:30')))
    expect(runs).toHaveLength(1)
    expect(runs[0].timing.route!.arrivalAt).toBe('2026-10-17T16:30:00.000Z')
  })
  it('accepts exactly 60 minutes and rejects one second more, including the transfer allowance', () => {
    const b = bundle(trip('a',0,'08:00','08:10'),trip('b',1,'09:10','09:30'))
    expect(timetableDepartures([route()],departureWindow(at('08:00')),b)).toHaveLength(1)
    b.trips[1].stops.forEach(stop => stop[1]++)
    expect(timetableDepartures([route()],departureWindow(at('08:00')),b)).toHaveLength(0)
  })
  it.each([['shortest',3],['few-stairs',5],['elevator',7]] as const)('uses the %s allowance without changing source facts', (mode, minutes) => {
    const paths = [route()], b = bundle(trip('a',0,'08:00','08:10'),trip('tight',1,'08:14','08:30'),trip('safe',1,'08:18','08:35'))
    const before = JSON.stringify({paths,b})
    const runs = timetableDepartures(paths,departureWindow(at('08:00')),b,undefined,mode)
    expect(runs[0].timing.transfers![0]).toMatchObject({testAllowanceMinutes:minutes})
    expect((runs[0].timing.legs![1] as {tripId?: string}).tripId).toBe(mode==='shortest'?'tight':'safe')
    expect(JSON.stringify({paths,b})).toBe(before)
  })
  it('keeps a later intermediate train when the earliest arrival would require over an hour at the next interchange', () => {
    const runs = timetableDepartures([route('three',3)],departureWindow(at('08:00')),bundle(trip('first',0,'08:00','08:10'),trip('early',1,'08:15','08:20'),trip('later',1,'08:50','09:00'),trip('last',2,'09:30','09:45')))
    expect(runs).toHaveLength(1)
    expect((runs[0].timing.legs![1] as {tripId?:string}).tripId).toBe('later')
  })
})

describe('next available half-hour', () => {
  it('moves a 01:00 query to the first feasible departure, retaining the half-open window', () => {
    const paths = [route('direct',1)], b = bundle(trip('first',0,'06:00','06:20'),trip('within',0,'06:29','06:49'),trip('end',0,'06:30','06:50'))
    const result = queryTimetable(paths,departureWindow(at('01:00')),b)
    expect(result.window.startAt).toBe(new Date(at('06:00')).toISOString())
    expect(result.departures.map(d=>(d.timing.legs![0] as {tripId?: string}).tripId)).toEqual(['first','within'])
    expect(displayCandidates(paths,result.departures,result.window,true)).toHaveLength(2)
    expect(queryTimetable(paths,departureWindow(at('06:01')),b).window.startAt).toBe(at('06:01'))
  })
  it('skips stranded first trains and checks the next civil day without skipping missing weekdays into a weekend', () => {
    const b=bundle(trip('stranded',0,'00:05','00:16'),trip('morning',0,'06:00','06:10'),trip('next',1,'06:15','06:30'))
    expect(queryTimetable([route()],departureWindow(at('00:00')),b).departures[0].timing.route!.departureAt).toBe(new Date(at('06:00')).toISOString())
    const daily=bundle(trip('daily',0,'06:00','06:20'))
    expect(queryTimetable([route('direct',1)],departureWindow(at('23:30')),daily).window.startAt).toBe('2026-10-17T22:00:00.000Z')
    daily.trips[0].calendar='rest_day'
    expect(queryTimetable([route('direct',1)],departureWindow('2026-10-19T01:00:00+08:00'),daily).departures).toEqual([])
  })
  it('does not broaden an invalid query or synthesize unavailable trains', () => {
    expect(queryTimetable([route()],{startAt:'bad',endAt:'bad'},bundle()).departures).toEqual([])
    expect(queryTimetable([route()],departureWindow(at('01:00')),bundle()).departures).toEqual([])
  })
  it('returns a full half-hour even when the next first train lies just inside the 24-hour lookup horizon', () => {
    const b=bundle(trip('first',0,'29:59','30:10'),trip('within',0,'30:20','30:30'),trip('end',0,'30:29','30:40'))
    b.trips.forEach(t=>{t.calendar='rest_day'}) // Friday has no previous service-day trains.
    const result=queryTimetable([route('direct',1)],departureWindow(at('06:00')),b)
    expect(result.departures).toHaveLength(2)
    expect(result.window.startAt).toBe('2026-10-17T21:59:00.000Z')
  })
})

describe('useful timetable alternatives', () => {
  const run=(id:string,departure:string,arrival:string,walk:number|null=null,transfers=1)=>({id,routeId:id,routeOverride:{...route(id),walkingMetres:walk,transferCount:transfers},timing:{route:{source:'timetable' as const,departureAt:at(departure),arrivalAt:at(arrival)}}})
  it('removes an earlier, slower alternative only above the ten-minute arrival threshold', () => {
    const slow=run('slow','08:00','09:00'), fast=run('fast','08:05','08:49')
    expect(usefulDepartures([slow,fast]).map(r=>r.id)).toEqual(['fast'])
    fast.timing.route.arrivalAt=at('08:50')
    expect(usefulDepartures([slow,fast])).toHaveLength(2)
    fast.timing.route.departureAt=at('08:00');fast.timing.route.arrivalAt=at('08:40')
    expect(usefulDepartures([slow,fast])).toHaveLength(2)
  })
  it('preserves a material known walking advantage, but not negligible savings or invented unknown savings', () => {
    const slow=run('slow','08:00','09:00',100), fast=run('fast','08:05','08:40',500)
    expect(usefulDepartures([slow,fast])).toHaveLength(2)
    slow.routeOverride.walkingMetres=490
    expect(usefulDepartures([slow,fast]).map(r=>r.id)).toEqual(['fast'])
    slow.routeOverride.walkingMetres=null
    expect(usefulDepartures([slow,fast]).map(r=>r.id)).toEqual(['fast'])
  })
  it('respects fewer-stairs priority and a modest no-transfer advantage', () => {
    const slow=run('slow','08:00','09:00'), fast=run('fast','08:05','08:49')
    slow.routeOverride.stairCount=0;fast.routeOverride.stairCount=20
    expect(usefulDepartures([slow,fast],'few-stairs')).toHaveLength(2)
    slow.routeOverride.transferCount=0
    expect(usefulDepartures([slow,fast])).toHaveLength(2)
    fast.timing.route.arrivalAt=at('08:30')
    expect(usefulDepartures([slow,fast]).map(r=>r.id)).toEqual(['fast'])
  })
})
