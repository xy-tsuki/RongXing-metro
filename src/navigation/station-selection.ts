import type { MetroDataset, Station } from '../core/types'

/** Prefer the fullest service's stop order, then include other patterns without merging names. */
export function stationsOnLine(dataset: MetroDataset, lineId: string): Station[] {
  const services = dataset.services.filter(service => service.lineId === lineId)
    .sort((a, b) => b.stops.length - a.stops.length)
  const stations = new Map(dataset.stations.map(station => [station.id, station]))
  const ids = [...new Set(services.flatMap(service => service.stops.map(stop => stop.stationId)))]
  return ids.flatMap(id => stations.has(id) ? [stations.get(id)!] : [])
}
