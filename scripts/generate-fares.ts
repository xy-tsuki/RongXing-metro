import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import network from '../src/data/fuzhou-network.json'
import mileage from '../src/data/fuzhou-line-distances.json'

type Edge = {
  to: string
  km: number
  lineId: string
  lineOrder: number
  district: 'main' | 'new'
}

type FarePair = {
  stationIdA: string
  stationIdB: string
  distanceKm: number
  mainAreaKm: number
  newDistrictKm: number
  mainAreaFareYuan: number
  newDistrictFareYuan: number
  fareYuan: number
  routeStationIds: string[]
  routeLineIds: string[]
}

const outputPath = resolve('src/data/fuzhou-fares.json')
const forwardServices = network.services.filter(service => service.id.endsWith('forward'))
const stationIds = network.stations.map(station => station.id)
const graph = new Map<string, Edge[]>()

for (const stationId of stationIds) graph.set(stationId, [])

for (const service of forwardServices) {
  const cumulativeKm = mileage.lines[service.lineId as keyof typeof mileage.lines]
  if (!cumulativeKm || cumulativeKm.length !== service.stops.length) {
    throw new Error(`${service.lineId}: mileage count does not match operating stops`)
  }
  for (let i = 1; i < service.stops.length; i += 1) {
    const from = service.stops[i - 1].stationId
    const to = service.stops[i].stationId
    const km = Number((cumulativeKm[i] - cumulativeKm[i - 1]).toFixed(3))
    if (!(km > 0)) throw new Error(`${service.lineId}: invalid segment distance at ${i}`)
    const district = service.lineId === 'fz-f1' && i > 5 ? 'new' : 'main'
    graph.get(from)!.push({ to, km, lineId: service.lineId, lineOrder: i - 1, district })
    graph.get(to)!.push({ to: from, km, lineId: service.lineId, lineOrder: i - 1, district })
  }
}

function dijkstra(source: string) {
  const distance = new Map<string, number>([[source, 0]])
  const previous = new Map<string, { stationId: string; edge: Edge }>()
  const remaining = new Set(stationIds)
  while (remaining.size) {
    let current: string | undefined
    let best = Number.POSITIVE_INFINITY
    for (const stationId of remaining) {
      const candidate = distance.get(stationId) ?? Number.POSITIVE_INFINITY
      if (candidate < best) {
        best = candidate
        current = stationId
      }
    }
    if (!current || !Number.isFinite(best)) break
    remaining.delete(current)
    for (const edge of graph.get(current) ?? []) {
      if (!remaining.has(edge.to)) continue
      const candidate = best + edge.km
      const old = distance.get(edge.to) ?? Number.POSITIVE_INFINITY
      if (candidate + 1e-9 < old) {
        distance.set(edge.to, candidate)
        previous.set(edge.to, { stationId: current, edge })
      }
    }
  }
  return { distance, previous }
}

function fareForMainKm(km: number) {
  if (km <= 5) return 2
  if (km <= 15) return 2 + Math.ceil((km - 5) / 5)
  if (km <= 29) return 4 + Math.ceil((km - 15) / 7)
  return 6 + Math.ceil((km - 29) / 9)
}

const pairs: FarePair[] = []
for (let i = 0; i < stationIds.length; i += 1) {
  const stationIdA = stationIds[i]
  const { distance, previous } = dijkstra(stationIdA)
  for (let j = i + 1; j < stationIds.length; j += 1) {
    const stationIdB = stationIds[j]
    if (!distance.has(stationIdB)) throw new Error(`unreachable station pair: ${stationIdA} -> ${stationIdB}`)

    const reverseStations = [stationIdB]
    const reverseEdges: Edge[] = []
    let cursor = stationIdB
    while (cursor !== stationIdA) {
      const step = previous.get(cursor)
      if (!step) throw new Error(`missing route for ${stationIdA} -> ${stationIdB}`)
      reverseEdges.push(step.edge)
      cursor = step.stationId
      reverseStations.push(cursor)
    }
    const routeStationIds = reverseStations.reverse()
    const routeEdges = reverseEdges.reverse()
    const mainAreaKm = Number(routeEdges.filter(edge => edge.district === 'main').reduce((sum, edge) => sum + edge.km, 0).toFixed(3))
    const newDistrictKm = Number(routeEdges.filter(edge => edge.district === 'new').reduce((sum, edge) => sum + edge.km, 0).toFixed(3))
    const mainAreaFareYuan = fareForMainKm(mainAreaKm)
    const newDistrictFareYuan = Math.floor(newDistrictKm * 0.3 + 0.5)
    pairs.push({
      stationIdA,
      stationIdB,
      distanceKm: Number(distance.get(stationIdB)!.toFixed(3)),
      mainAreaKm,
      newDistrictKm,
      mainAreaFareYuan,
      newDistrictFareYuan,
      fareYuan: Math.max(2, mainAreaFareYuan + newDistrictFareYuan),
      routeStationIds,
      routeLineIds: [...new Set(routeEdges.map(edge => edge.lineId))]
    })
  }
}

const output = {
  schemaVersion: 1,
  city: 'fuzhou',
  currency: 'CNY',
  unit: 'yuan',
  generatedAt: '2026-10-26',
  sourceNetwork: 'src/data/fuzhou-network.json',
  sourceMileage: 'src/data/fuzhou-line-distances.json',
  fareRuleSource: 'https://fgw.fuzhou.gov.cn/fgwzwgk/tzgg/202509/t20250923_5082003.htm',
  routeBasis: 'minimum modeled rail distance; station-to-station mileage paths use the current operating network and in-station line transfers only',
  limitations: [
    'This is an estimated adult single-journey base-fare dataset, not an official station-pair fare table. Discounts and operator promotions are excluded.',
    'Wikipedia Binhai Express cumulative mileages are rounded to 0.1 km; fare rows affected by those distances are approximate. Official F1 fare examples are used as acceptance checks.',
    'Out-of-station connections between Line 1 Sanchajie and Binhai Express Sanchajie, and between Line 2 Shuibu and Binhai Express Mindu, are not treated as continuous-fare transfers.',
    'No transfer-time, service availability, accessibility, or route-planner ranking is represented here.'
  ],
  fareRules: {
    mainArea: { initialKmInclusive: 5, initialFareYuan: 2, bands: [{ fromKmExclusive: 5, toKmInclusive: 15, bandKm: 5, incrementYuan: 1 }, { fromKmExclusive: 15, toKmInclusive: 29, bandKm: 7, incrementYuan: 1 }, { fromKmExclusive: 29, toKmInclusive: null, bandKm: 9, incrementYuan: 1 }] },
    newDistrict: { startStationId: 'fz-帝封江', endStationIds: ['fz-机场', 'fz-文岭'], yuanPerKm: 0.3, rounding: 'nearest yuan, half up' },
    minimumSingleJourneyFareYuan: 2
  },
  stationCount: stationIds.length,
  unorderedPairCount: pairs.length,
  pairs
}

async function main() {
  if (process.argv.includes('--check')) {
    const existing = JSON.parse(await readFile(outputPath, 'utf8'))
    if (JSON.stringify(existing) !== JSON.stringify(output)) throw new Error('Fare database is stale; run npm run fare:generate')
  } else {
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    console.log(`Wrote ${pairs.length} unordered station pairs for ${stationIds.length} stations to ${outputPath}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
