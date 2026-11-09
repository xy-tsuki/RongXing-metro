import packed from '../data/timetable-test.json'
import type { TestTimetable, TestTrip } from '../maintenance/timetable-types'
import type { JourneyLeg, JourneyRoute, MetroDataset, RouteMode } from '../core/types'
import type { DepartureCandidate, DepartureWindow } from './departures'
import { departureWindow } from './departures'
import { usefulDepartures } from './departure-selection'
import { routeFareLookup } from './fare-presentation'
import type { JourneyTiming, TimingValue } from './timing'
import type { ServiceClass } from './service-class'
import { transferAllowance } from './transfer-allowance'
import { tripSchedule, mergeSchedules, TIMETABLE_SOURCE_NOTICE } from './schedule-presentation'
import { calendarServesDate, chinaDateAt, validServiceDate } from './service-calendar'

export const testTimetable = packed as TestTimetable
export const TEST_TIMETABLE_NOTICE = TIMETABLE_SOURCE_NOTICE
export function hasTimetableCoverage(routes: JourneyRoute[], bundle = testTimetable) {
  const services = new Set(bundle.trips.map(t => t.serviceId))
  return routes.some(r => r.legs.length > 0 && r.legs.every(l => services.has(l.serviceId)))
}
export type TestTiming = TimingValue & { testRun: true; tripId?: string; stopStationIds?: string[]; transferFeasibility?: 'unknown'; testAllowanceMinutes?: number }
export interface TestDeparture extends DepartureCandidate { routeOverride: JourneyRoute }
const DAY = 86400_000, OFFSET = 480 * 60_000
const MAX_TRANSFER_MINUTES = 60
const iso = (value: number) => new Date(value).toISOString()
const cityMidnight = (value: number) => Math.floor((value + OFFSET) / DAY) * DAY - OFFSET
export function servesDay(trip: TestTrip, midnight: number): boolean {
  return calendarServesDate(trip.calendar, chinaDateAt(midnight))
}
export const trainClass = (type: string): ServiceClass => type === 'limited_express' ? 'limited-express' : type === 'direct_express' ? 'direct-express' : 'local'

interface Ride { trip: TestTrip; day: number; from: number; to: number; departure: number; arrival: number }
function ridesFor(leg: JourneyLeg, start: number, end: number, bundle: TestTimetable): Ride[] {
  const result: Ride[] = []
  for (const trip of bundle.trips) {
    if (trip.serviceId !== leg.serviceId) continue
    const from = trip.stops.findIndex(s => s[0] === leg.fromStationId), to = trip.stops.findIndex(s => s[0] === leg.toStationId)
    if (from < 0 || to <= from) continue // Express trains must actually serve both stations.
    for (let day = cityMidnight(start) - DAY; day <= cityMidnight(end); day += DAY) {
      if (!servesDay(trip, day)) continue
      const departure = day + trip.stops[from][1] * 1000, arrival = day + trip.stops[to][1] * 1000
      if (departure >= start && departure < end && arrival > departure) result.push({ trip, day, from, to, departure, arrival })
    }
  }
  return result.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival || a.trip.id.localeCompare(b.trip.id))
}
/** All source trips are enabled for the user-authorized test; graph and facility facts remain untouched. */
export function timetableDepartures(routes: JourneyRoute[], window: DepartureWindow, bundle = testTimetable, dataset?: MetroDataset, mode: RouteMode = 'shortest'): TestDeparture[] {
  const start = Date.parse(window.startAt), end = Date.parse(window.endAt), result: TestDeparture[] = []
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
  const byService = new Map<string, TestTrip[]>()
  for (const trip of bundle.trips) { const list = byService.get(trip.serviceId) ?? []; list.push(trip); byService.set(trip.serviceId, list) }
  for (const route of routes) {
    if (!route.legs.length || route.confidence === 'demo') continue
    const rides = (i: number, from: number, to: number) => ridesFor(route.legs[i], from, to, { ...bundle, trips: byService.get(route.legs[i].serviceId) ?? [] })
    const suffixes = new Map<string, Ride[] | null>()
    // Memoized temporal search: an earliest intermediate arrival can be stranded
    // by the one-hour bound, so consider later trains before selecting a suffix.
    const connect = (i: number, previousArrival: number): Ride[] | null => {
      if (i === route.legs.length) return []
      const key = `${i}:${previousArrival}`
      if (suffixes.has(key)) return suffixes.get(key)!
      const guide = route.transfers[i - 1]
      const earliest = previousArrival + transferAllowance(guide, guide?.path, dataset, mode).minutes * 60_000
      const latest = previousArrival + MAX_TRANSFER_MINUTES * 60_000
      let best: Ride[] | null = null
      for (const next of earliest <= latest ? rides(i, earliest, latest + 1) : []) {
        const tail = connect(i + 1, next.arrival)
        if (!tail) continue
        const candidate = [next, ...tail]
        if (!best || candidate[candidate.length - 1].arrival < best[best.length - 1].arrival) best = candidate
      }
      suffixes.set(key, best)
      return best
    }
    for (const first of rides(0, start, end)) {
      const tail = connect(1, first.arrival)
      if (!tail) continue
      const selected = [first, ...tail]
      const timing: JourneyTiming = { legs: {}, transfers: {} }
      const legs = route.legs.map((leg, index) => {
        const ride = selected[index], stops = ride.trip.stops.slice(ride.from, ride.to + 1).map(s => s[0])
        const value: TestTiming = { source: 'timetable', testRun: true, tripId: ride.trip.id, stopStationIds: stops, serviceClass: trainClass(ride.trip.type), schedule: tripSchedule(ride.trip),
          departureAt: iso(ride.departure), arrivalAt: iso(ride.arrival), durationMinutes: (ride.arrival - ride.departure) / 60_000, utcOffsetMinutes: 480 }
        timing.legs![index] = value
        if (index > 0) {
          const previous = selected[index - 1], path = route.transfers[index - 1]?.path
          const transfer: TestTiming = { source: 'timetable', testRun: true, transferFeasibility: 'unknown', testAllowanceMinutes: transferAllowance(route.transfers[index - 1], path, dataset, mode).minutes, departureAt: iso(previous.arrival), arrivalAt: iso(ride.departure) }
          if (path) { transfer.walkingMinutes = path.minutes; transfer.waitingMinutes = Math.max(0, (ride.departure - previous.arrival) / 60_000 - path.minutes) }
          timing.transfers![index - 1] = transfer
        }
        return { ...leg, stopCount: ride.to - ride.from, rideMinutes: value.durationMinutes! }
      })
      const arrival = selected[selected.length - 1].arrival
      const value: TestTiming = { source: 'timetable', testRun: true, schedule: mergeSchedules(selected.map(ride => tripSchedule(ride.trip))), departureAt: iso(first.departure), arrivalAt: iso(arrival), durationMinutes: (arrival - first.departure) / 60_000, utcOffsetMinutes: 480 }
      timing.route = value
      const routeOverride = { ...route, legs, totalMinutes: value.durationMinutes!, rideMinutes: legs.reduce((sum, leg) => sum + leg.rideMinutes, 0) }
      result.push({ id: `test:${bundle.version}:${route.id}:${selected.map(r => `${r.trip.id}@${r.day}`).join('|')}`, routeId: route.id, timing, routeOverride })
    }
  }
  return result.sort((a, b) => Date.parse(a.timing.route!.departureAt!) - Date.parse(b.timing.route!.departureAt!) || Date.parse(a.timing.route!.arrivalAt!) - Date.parse(b.timing.route!.arrivalAt!))
}
export function queryTimetable(routes: JourneyRoute[], window: DepartureWindow, bundle = testTimetable, dataset?: MetroDataset, mode: RouteMode = 'shortest') {
  const fareFor = dataset ? routeFareLookup(dataset) : undefined
  const current = timetableDepartures(routes, window, bundle, dataset, mode)
  if (current.length) return { window, departures: usefulDepartures(current, mode, fareFor) }
  const start = Date.parse(window.startAt), end = Date.parse(window.endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end >= start + DAY) return { window, departures: current }
  // Search actual calendar-matching runs only, within 24h of the requested time.
  // Anchor before pruning so an overtaken first train does not shift the window.
  const upcoming = timetableDepartures(routes, { startAt: iso(end), endAt: iso(start + DAY) }, bundle, dataset, mode)
  if (!upcoming.length) return { window, departures: [] }
  const nextWindow = departureWindow(upcoming[0].timing.route!.departureAt!)
  const nextRuns = Date.parse(nextWindow.endAt) <= start + DAY
    ? upcoming.filter(item => Date.parse(item.timing.route!.departureAt!) < Date.parse(nextWindow.endAt))
    : timetableDepartures(routes, nextWindow, bundle, dataset, mode)
  return { window: nextWindow, departures: usefulDepartures(nextRuns, mode, fareFor) }
}
export function stationDayDepartures(stationId: string, serviceId: string, serviceDate: string, bundle = testTimetable) {
  const day = Date.parse(`${serviceDate}T00:00:00+08:00`)
  if (!validServiceDate(serviceDate) || !Number.isFinite(day)) return []
  return bundle.trips.filter(t => t.serviceId === serviceId && servesDay(t, day)).flatMap(trip => {
    const stop = trip.stops.find(s => s[0] === stationId)
    return stop ? [{ tripId: trip.id, seconds: stop[1], departureAt: iso(day + stop[1] * 1000), type: trainClass(trip.type), quality: trip.quality, schedule: tripSchedule(trip) }] : []
  }).sort((a, b) => a.seconds - b.seconds || a.tripId.localeCompare(b.tripId))
}
export function serviceClock(seconds: number) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}${seconds % 60 ? ':' + String(seconds % 60).padStart(2, '0') : ''}`
}
