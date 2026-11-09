import data from './fare-display-data.json'
import type { JourneyRoute, MetroDataset } from '../core/types'
import { calculateFareJourney } from '../core/fare-journey'

export interface FareQuote { amount: number; mainArea: number; newDistrict: number }
export interface FarePresentation { quote: FareQuote; segments: { fromStationId: string; toStationId: string; fareYuan: number }[] }
const ids = new Map(data.stations.map((id, index) => [id, index]))
const quotes = new Map(data.quotes.map(row => [row[0] + ':' + row[1], row]))
/** User-confirmed entry/exit shortest-route basis, independent of the chosen transfer path. */
export function farePresentation(input: {
  cityId?: string; networkVersion?: string; from?: string; to?: string; demo?: boolean; route?: JourneyRoute
}): FarePresentation | null {
  if (input.demo || input.route?.confidence === 'demo' || input.cityId !== data.cityId || !input.from || !input.to) return null
  if (input.networkVersion && input.networkVersion !== data.sourceNetworkVersion) return null
  if (!ids.has(input.from) || !ids.has(input.to)) return null
  const sameStation = input.from === input.to
  const legs = input.route?.legs ?? []
  // Access/egress walks do not enter another paid area. A walking-only route has no fare.
  if (!sameStation && !legs.length) return null
  const external = (input.route?.transfers ?? []).filter(transfer => transfer.kind === 'external' ||
    transfer.fromStationId && transfer.toStationId && transfer.fromStationId !== transfer.toStationId)
  if (external.some(transfer => !transfer.fromStationId || !transfer.toStationId)) return null
  const result = calculateFareJourney({
    originStationId: sameStation ? input.from : legs[0].fromStationId,
    destinationStationId: sameStation ? input.to : legs[legs.length-1].toStationId,
    externalTransfers: sameStation ? [] : external.map(transfer => ({fromStationId:transfer.fromStationId!, toStationId:transfer.toStationId!})),
    lookup: (fromId, toId) => {
      const from = ids.get(fromId), to = ids.get(toId)
      if (from === undefined || to === undefined) return null
      const row = quotes.get(from+':'+to) ?? quotes.get(to+':'+from)
      return row && row[2] > 0 ? {fareYuan:row[2], mainAreaFareYuan:row[3], newDistrictFareYuan:row[4]} : null
    },
  })
  if (result.status !== 'complete' || result.totalFareYuan === null || result.segments.some(segment => segment.fareYuan === null)) return null
  return {
    quote: {amount:result.totalFareYuan, mainArea:result.segments.reduce((sum, segment)=>sum+segment.mainAreaFareYuan!,0), newDistrict:result.segments.reduce((sum, segment)=>sum+segment.newDistrictFareYuan!,0)},
    segments: result.segments.map(segment=>({fromStationId:segment.fromStationId,toStationId:segment.toStationId,fareYuan:segment.fareYuan!})),
  }
}
export const fareDisplaySources = { generatedAt: data.generatedAt, ruleSource: data.ruleSource, distanceSource: data.distanceSource }

/** The planner and presentation share the same paid-area and version checks. */
export function routeFareLookup(dataset: MetroDataset): (route: JourneyRoute) => number | null {
  const cache = new Map<string, number | null>()
  return route => {
    if (!route.legs.length) return null
    if (cache.has(route.id)) return cache.get(route.id)!
    const access = route.accessTransfers ?? [], egress = route.egressTransfers ?? []
    const from = access[0]?.fromStationId ?? route.legs[0].fromStationId
    const to = egress[egress.length - 1]?.toStationId ?? route.legs[route.legs.length - 1].toStationId
    const fare = farePresentation({ cityId:dataset.city.id, networkVersion:dataset.version, from, to, route })?.quote.amount ?? null
    cache.set(route.id, fare)
    return fare
  }
}
