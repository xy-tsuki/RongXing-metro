import type { JourneyRoute, RouteMode } from '../core/types'
import type { DepartureCandidate } from './departures'

const minute = 60_000
/** Explicit policy, in minutes per yuan; not a monetary measurement of walking. */
export const FARE_MINUTES_PER_YUAN = 5
export type RouteFare = (route: JourneyRoute) => number | null
const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function transferMetres(item: DepartureCandidate): number | null {
  const transfers = item.routeOverride?.transfers
  return transfers && transfers.every(t => t.path && known(t.path.metres)) ? transfers.reduce((sum, t) => sum + t.path!.metres, 0) : null
}

/** Only compare supplied clocks and known costs. Unknown walking is never zero. */
export function usefulDepartures<T extends DepartureCandidate>(items: T[], mode: RouteMode = 'shortest', fareFor?: RouteFare): T[] {
  return items.filter(slow => !items.some(fast => {
    const slowDeparture = Date.parse(slow.timing.route?.departureAt ?? ''), fastDeparture = Date.parse(fast.timing.route?.departureAt ?? '')
    const lostMinutes = (Date.parse(slow.timing.route?.arrivalAt ?? '') - Date.parse(fast.timing.route?.arrivalAt ?? '')) / minute
    const a = slow.routeOverride, b = fast.routeOverride
    if (!a || !b) return false
    const slowFare = fareFor?.(a), fastFare = fareFor?.(b)
    // With a fare provider, an unknown price cannot prove either route dearer.
    if (fareFor && (!known(slowFare) || !known(fastFare))) return false
    const moreExpensiveAndDominated = known(slowFare) && known(fastFare) && slowFare > fastFare && fastDeparture >= slowDeparture && lostMinutes >= 0
    const timeDominated = fastDeparture > slowDeparture && lostMinutes > 10
    if (!moreExpensiveAndDominated && !timeDominated) return false
    // Preserve meaningful savings: >=100m, increasing by 10m per minute lost.
    const requiredSaving = Math.max(100, lostMinutes * 10)
    const savesWalking = (x: number | null, y: number | null) => known(x) && known(y) && y - x >= requiredSaving
    if (savesWalking(a.walkingMetres, b.walkingMetres) || savesWalking(transferMetres(slow), transferMetres(fast))) return false
    if (mode === 'few-stairs' && known(a.stairCount) && known(b.stairCount) && a.stairCount < b.stairCount) return false
    // Even a small time difference can disqualify a dearer, earlier, slower
    // option, unless it has another known advantage.
    if (moreExpensiveAndDominated && a.transferCount < b.transferCount) return false
    if (moreExpensiveAndDominated && known(a.stairCount) && known(b.stairCount) && a.stairCount < b.stairCount) return false
    if (moreExpensiveAndDominated) return true
    if (known(slowFare) && known(fastFare) && slowFare < fastFare && (fastFare - slowFare) * FARE_MINUTES_PER_YUAN >= lostMinutes - 10) return false
    // One less change remains useful for a modest delay, not for an unlimited detour.
    if (a.transferCount < b.transferCount && lostMinutes <= 20) return false
    return true
  }))
}

/** Recommend among comparable timed fares; incomplete data retains the existing selection. */
export function recommendedDeparture<T extends DepartureCandidate>(items: T[], fallback: T | undefined, mode: RouteMode, fareFor?: RouteFare): T | undefined {
  if (!fallback || !fareFor || !items.length) return fallback
  const rows = items.map(item => ({ item, route: item.routeOverride, fare: item.routeOverride ? fareFor(item.routeOverride) : null, arrival: Date.parse(item.timing.route?.arrivalAt ?? '') }))
  if (rows.some(row => !row.route || !known(row.fare) || !Number.isFinite(row.arrival))) return fallback
  let eligible = rows
  const metrics: Array<(route: JourneyRoute) => number | null> = mode === 'few-stairs'
    ? [route => route.stairCount, route => route.walkingMetres]
    : [route => route.walkingMetres, route => route.stairCount]
  for (const metric of metrics) {
    const values = eligible.map(row => metric(row.route!))
    if (!values.some(known)) break
    if (!values.every(known)) return eligible.find(row => row.item === fallback)?.item ?? eligible[0].item
    const minimum = Math.min(...values)
    eligible = eligible.filter((_, index) => values[index] === minimum)
  }
  let best: T | undefined, score = Infinity
  for (const row of eligible) {
    const candidateScore = row.arrival + row.fare! * FARE_MINUTES_PER_YUAN * minute
    if (candidateScore < score || candidateScore === score && row.item === fallback) { score = candidateScore; best = row.item }
  }
  return best ?? fallback
}
