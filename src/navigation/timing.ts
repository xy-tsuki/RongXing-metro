import type { JourneyRoute, PlanRequest } from '../core/types'
import type { DepartureCandidate, DepartureWindow } from './departures'
import type { ServiceClass } from './service-class'
import type { ScheduleEvidence } from './schedule-presentation'

export interface TimingValue {
  /** ISO 8601 with explicit offset or Z. Never use a device-local date string. */
  departureAt?: string; arrivalAt?: string
  durationMinutes?: number; walkingMinutes?: number; waitingMinutes?: number
  source: 'timetable' | 'realtime' | 'estimate' | 'demo'
  /** Explicit per-run class; never inferred from the line name or number of stops. */
  serviceClass?: ServiceClass
  /** Display-only provenance, separate from source and per-trip raw quality. */
  schedule?: ScheduleEvidence
  utcOffsetMinutes?: number; updatedAt?: string
}
export interface JourneyTiming {
  route?: TimingValue
  legs?: Record<number, TimingValue>
  transfers?: Record<number, TimingValue>
}
export interface DepartureIntent { kind: 'now' | 'scheduled'; departureAt?: string }
/** UI extension contracts only. No provider or live train positioning is implemented. */
export interface NavigationEnrichmentProvider {
  /** Complete provider-calculated runs, including transfer feasibility; no UI-made real departures. */
  departures?(routes: JourneyRoute[], request: PlanRequest, window: DepartureWindow): Promise<DepartureCandidate[]>
  timing?(routes: JourneyRoute[], request: PlanRequest, departure: DepartureIntent): Promise<Record<string, JourneyTiming>>
  trainPosition?(serviceId: string): Promise<{ source: 'realtime' | 'timetable-estimate'; observedAt: string; stationId?: string; nextStationId?: string; expectedArrivalAt?: string; progress?: number } | null>
  transferFeasibility?(routeId: string, transferIndex: number): Promise<{ status: 'possible' | 'missed' | 'unknown'; source: string; assessedAt: string; availableMinutes?: number; requiredMinutes?: number; reason?: string }>
}

export function estimatedJourneyTiming(route: JourneyRoute): JourneyTiming {
  const source = route.confidence === 'demo' ? 'demo' as const : 'estimate' as const
  return {
    route: { source, ...(route.totalMinutes !== null ? { durationMinutes: route.totalMinutes } : {}) },
    legs: Object.fromEntries(route.legs.map((leg, i) => [i, { source, ...(leg.rideMinutes !== null ? { durationMinutes: leg.rideMinutes } : {}) }])),
  }
}
export function clockText(value: string | undefined, offset = 480): string | null {
  if (!value || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return null
  const date = new Date(stamp + offset * 60_000)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}
export function validMinutes(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null
}
export function arrivalDayLabel(departure?: string, arrival?: string, offset = 480): string {
  if (!clockText(departure, offset) || !clockText(arrival, offset)) return ''
  const day = (value: string) => Math.floor((Date.parse(value) + offset * 60_000) / 86_400_000)
  const difference = day(arrival!) - day(departure!)
  return difference > 0 ? difference === 1 ? '次日' : `+${difference}天` : ''
}
