import type { JourneyRoute } from '../core/types'
import type { JourneyTiming } from './timing'
import { clockText, estimatedJourneyTiming } from './timing'

/** A departure instance is separate from a path. Providers may return many runs of one path. */
export interface DepartureCandidate {
  id: string
  routeId: string
  timing: JourneyTiming
  /** Per-run stop pattern and durations; the graph route remains unchanged. */
  routeOverride?: JourneyRoute
}
export interface DisplayCandidate extends DepartureCandidate { routeIndex: number; route: JourneyRoute }
export interface DepartureWindow { startAt: string; endAt: string }
export function departureWindow(startAt: string): DepartureWindow {
  return { startAt, endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString() }
}
export function inDepartureWindow(items: DepartureCandidate[], window: DepartureWindow): DepartureCandidate[] {
  const start = Date.parse(window.startAt), end = Date.parse(window.endAt)
  if (!clockText(window.startAt) || !clockText(window.endAt) || end <= start) return []
  const ids = new Set<string>()
  return items.filter(item => {
    const value = item.timing.route, departure = Date.parse(value?.departureAt ?? ''), arrival = Date.parse(value?.arrivalAt ?? '')
    if (!item.id || ids.has(item.id) || !clockText(value?.departureAt) || !clockText(value?.arrivalAt)
      || value?.source === 'estimate' || departure < start || departure >= end || arrival <= departure) return false
    ids.add(item.id); return true
  }).sort((a, b) => Date.parse(a.timing.route!.departureAt!) - Date.parse(b.timing.route!.departureAt!) || a.id.localeCompare(b.id))
}
export function displayCandidates(routes: JourneyRoute[], departures: DepartureCandidate[], window: DepartureWindow, timetableAvailable: boolean): DisplayCandidate[] {
  if (!timetableAvailable) return routes.map((route, routeIndex) => ({ id: 'path:' + route.id, routeId: route.id, routeIndex, route, timing: estimatedJourneyTiming(route) }))
  return inDepartureWindow(departures, window).flatMap(item => {
    const routeIndex = routes.findIndex(route => route.id === item.routeId)
    return routeIndex < 0 ? [] : [{ ...item, routeIndex, route: item.routeOverride ?? routes[routeIndex] }]
  })
}
/** Synthetic UI fixture only. Never creates schedules for a real/partial/verified network. */
export function demoDepartures(routes: JourneyRoute[], window: DepartureWindow): DepartureCandidate[] {
  const start = Date.parse(window.startAt), items: DepartureCandidate[] = []
  routes.forEach((route, routeIndex) => {
    if (route.confidence !== 'demo' || !route.legs.length || route.legs.some(leg => leg.rideMinutes === null)) return
    const firstMinute = Math.ceil(start / 60_000)
    const phase = ((routeIndex * 2 + 1 - firstMinute % 10) % 10 + 10) % 10
    for (let departureMinute = firstMinute + phase; departureMinute * 60_000 < Date.parse(window.endAt); departureMinute += 10) {
      const timing: JourneyTiming = { legs: {}, transfers: {} }
      const departure = departureMinute * 60_000
      let cursor = departure
      route.legs.forEach((leg, index) => {
        if (!Number.isFinite(cursor)) return
        const arrival = cursor + leg.rideMinutes! * 60_000
        timing.legs![index] = { source: 'demo', departureAt: new Date(cursor).toISOString(), arrivalAt: new Date(arrival).toISOString(), durationMinutes: leg.rideMinutes! }
        cursor = arrival
        if (route.transfers[index]) {
          const walking = route.doorCombinations[0]?.transferPaths[index]?.minutes ?? route.transfers[index].path?.minutes
          // No unconfirmed transfer is promoted into a timed itinerary, even in this fixture.
          if (walking === undefined) { cursor = NaN; return }
          const mockWalking = Math.ceil(walking)
          timing.transfers![index] = { source: 'demo', walkingMinutes: mockWalking, waitingMinutes: 1 }
          cursor += (mockWalking + 1) * 60_000
        }
      })
      if (!Number.isFinite(cursor)) continue
      timing.route = { source: 'demo', departureAt: new Date(departure).toISOString(), arrivalAt: new Date(cursor).toISOString(), durationMinutes: (cursor - departure) / 60_000 }
      items.push({ id: `demo:${route.id}:${departure}`, routeId: route.id, timing })
    }
  })
  return inDepartureWindow(items, window)
}

export const MINUTE_PIXELS = 12
export const BOARD_TOP = 68
export function columnMetrics(viewportWidth: number) {
  // Four whole columns and 35% of the fifth, with the same density on every phone.
  const width = (viewportWidth - 16) / 4.35 - 6
  return { width, stride: width + 6, inset: 8 }
}
export function candidateGeometry(item: DisplayCandidate, window: DepartureWindow, timed: boolean) {
  if (!timed) return { top: BOARD_TOP, height: Math.max(220, item.route.legs.length * 90 + 55) }
  const time = item.timing.route!
  return {
    top: BOARD_TOP + (Date.parse(time.departureAt!) - Date.parse(window.startAt)) / 60_000 * MINUTE_PIXELS,
    height: (Date.parse(time.arrivalAt!) - Date.parse(time.departureAt!)) / 60_000 * MINUTE_PIXELS,
  }
}
export const BOARD_SWIPE_ANGLE_DEGREES = 15
/** Horizontal input follows a 15-degree slope; release still auto-fits the time origin. */
export function diagonalDrag(startX: number, startY: number, fingerDelta: number, maxX: number) {
  const x = Math.max(0, Math.min(maxX, startX - fingerDelta))
  return { x, y: startY + (x - startX) * Math.tan(BOARD_SWIPE_ANGLE_DEGREES * Math.PI / 180) }
}
