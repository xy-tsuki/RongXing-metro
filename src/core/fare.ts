import fareDatabase from '../data/fuzhou-fares.json'

export type StationFare = (typeof fareDatabase.pairs)[number]

const pairByKey = new Map<string, StationFare>()
for (const pair of fareDatabase.pairs) {
  pairByKey.set(`${pair.stationIdA}\u0000${pair.stationIdB}`, pair)
  pairByKey.set(`${pair.stationIdB}\u0000${pair.stationIdA}`, {
    ...pair,
    stationIdA: pair.stationIdB,
    stationIdB: pair.stationIdA,
    routeStationIds: [...pair.routeStationIds].reverse(),
    routeLineIds: [...pair.routeLineIds].reverse()
  })
}

/** Returns the base adult single-journey fare estimate for a station pair. */
export function getStationFare(fromStationId: string, toStationId: string): StationFare | null {
  if (fromStationId === toStationId) return null
  return pairByKey.get(`${fromStationId}\u0000${toStationId}`) ?? null
}

export function getStationFareDatabase() {
  return fareDatabase
}
