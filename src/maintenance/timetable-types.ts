/** Separate from the navigation graph protocol. Original source fields stay in the local evidence DB. */
export interface TestTimetable {
  format: 'rongxing-test-timetable/1'
  version: string
  timezone: 'Asia/Shanghai'
  policy: 'all-source-times-as-test-departures'
  notice: string
  stations: { id: string; lineId: string; name: string; order: number }[]
  trips: TestTrip[]
}
export interface TestTrip {
  id: string; lineId: string; serviceId: string
  type: string; calendar: 'rest_day' | 'workday' | 'all_days'; quality: string
  /** Each pair: canonical station ID, service-day departure seconds (can exceed 86400). */
  stops: [string, number][]
}
