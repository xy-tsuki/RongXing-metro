import type { MetroDataset } from '../core/types'
/** Show stops of only the selected line, retaining identities at external interchanges. */
export function stationsForCollection(dataset: Pick<MetroDataset,'services'|'stations'>, lineId: string) {
  const services = dataset.services.filter(service => service.lineId === lineId).sort((a,b)=>b.stops.length-a.stops.length)
  const stations = new Map(dataset.stations.map(station=>[station.id,station]))
  return [...new Set(services.flatMap(service=>service.stops.map(stop=>stop.stationId)))].flatMap(id=>stations.has(id)?[stations.get(id)!]:[])
}
