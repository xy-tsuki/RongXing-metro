/** Reproducible synthetic fixture, never a source of real-world station geometry. */
import { mkdirSync, writeFileSync } from 'node:fs'
import type { MetroDataset, WalkEdge } from '../src/core/types'
import { validateDataset } from '../src/core/validation'
import { tableNames, toCsv } from './data-csv'

const provenance = { kind: 'demo' as const, source: '手工构建的虚构教学网络；未开展现场测绘；禁止用于真实出行', recordedAt: '2026-10-16' }
const d: MetroDataset = {
  schemaVersion: '1.0', version: 'demo-2026.10.16.1', city: { id: 'fuzhou-synthetic', name: '福州 · 合成演示' }, provenance,
  description: '仅借用福州作为产品起点，以下所有站名、线路连接、运行方向、车辆及设施位置均为虚构模拟；不代表福州地铁实际网络。',
  stations: [
    ['s-west', '西门'], ['s-central', '中央广场'], ['s-river', '滨江'], ['s-north', '北苑'],
    ['s-science', '科创园'], ['s-bay', '海湾'], ['s-unknown', '缺测站'], ['s-east', '东岸'],
  ].map(([id, name]) => ({ id, name, concourseNodeIds: [`${id}:hall`], indoorData: id === 's-unknown' ? 'missing' : 'complete' })),
  lines: [{ id: 'l1', name: '演示1号线', color: '#167A69' }, { id: 'l2', name: '演示2号线', color: '#C67835' }, { id: 'l3', name: '演示3号线', color: '#5865B9' }, { id: 'l4', name: '演示联络线', color: '#A75175' }],
  formations: [{ id: 'three-car', cars: 3, positions: [0, 16, 40, 56, 80, 96].map((x, i) => ({ id: `p${i + 1}`, car: Math.floor(i / 2) + 1, door: i % 2 + 1, longitudinalMetres: x })) }],
  platforms: [], services: [], walkNodes: [], walkEdges: [],
}
for (const s of d.stations) d.walkNodes.push({ id: `${s.id}:hall`, stationId: s.id, level: 0, label: `${s.name}付费站厅（出口未指定）`, kind: 'concourse', knowledge: s.id === 's-unknown' ? 'unknown' : 'confirmed' })
function edge(from: string, to: string, kind: WalkEdge['kind'], metres: number, seconds: number, stairCount = 0, unknown = false) {
  d.walkEdges.push({ id: `e${d.walkEdges.length + 1}`, from, to, kind, metres, seconds, stairCount, knowledge: unknown ? 'unknown' : 'confirmed', wheelchair: kind === 'stairs' || kind === 'escalator' ? 'blocked' : unknown ? 'unknown' : 'confirmed', bidirectional: true, provenance })
}
const lineStops: Record<string, string[]> = { l1: ['s-west', 's-central', 's-river'], l2: ['s-north', 's-central', 's-science', 's-unknown'], l3: ['s-science', 's-bay', 's-east'], l4: ['s-river', 's-science'] }
for (const line of d.lines) for (const reverse of [false, true]) {
  const stops = reverse ? [...lineStops[line.id]].reverse() : lineStops[line.id]
  const suffix = reverse ? 'inbound' : 'outbound'
  const service = { id: `${line.id}-${suffix}`, lineId: line.id, formationId: 'three-car', direction: d.stations.find(s => s.id === stops[stops.length - 1])!.name, stops: [] as MetroDataset['services'][number]['stops'] }
  for (const stationId of stops) {
    const platformId = `${stationId}:${line.id}:${suffix}`, level = line.id === 'l1' ? -1 : line.id === 'l2' ? -2 : -3
    const platform = { id: platformId, stationId, lineId: line.id, level, doorNodes: {} as Record<string, string> }
    const station = d.stations.find(s => s.id === stationId)!, unknown = stationId === 's-unknown'
    const formation = d.formations[0]
    // Directional platforms may have different geometry; the car-position ID remains fixed while riding.
    for (const p of formation.positions) {
      const id = `${platformId}:${p.id}`
      platform.doorNodes[p.id] = id
      d.walkNodes.push({ id, stationId, level, label: `${line.name}往${service.direction}方向 ${p.car}车${p.door}门`, kind: 'door', knowledge: unknown ? 'unknown' : 'confirmed' })
    }
    // The reverse platform mirrors its facilities, rather than mirroring the vehicle labels.
    const mirrored = (x: number) => reverse ? 96 - x : x
    // metres is pedestrian distance. Lift/escalator values are synthetic
    // approach/exit walking costs, not shaft or equipment transport distances.
    // seconds additionally includes the device ride itself.
    const stairsX: Record<string, number> = { l1: 8, l2: 48, l3: 88, l4: 8 }
    const layouts = [{ kind: 'stairs' as const, x: mirrored(stairsX[line.id]), metres: 14, seconds: 30, stairs: 22 }, { kind: 'escalator' as const, x: mirrored(88), metres: 22, seconds: 38, stairs: 0 }, { kind: 'lift' as const, x: mirrored(48), metres: 40, seconds: 75, stairs: 0 }]
    for (const facility of layouts) {
      const id = `${platformId}:${facility.kind}`
      d.walkNodes.push({ id, stationId, level, label: `${line.name}站台${facility.kind === 'lift' ? '电梯' : facility.kind === 'stairs' ? '楼梯' : '扶梯'}`, kind: 'facility', knowledge: unknown ? 'unknown' : 'confirmed' })
      edge(`${stationId}:hall`, id, facility.kind, facility.metres, facility.seconds, facility.stairs, unknown)
      for (const p of formation.positions) {
        const distance = Math.abs(p.longitudinalMetres! - facility.x)
        edge(id, platform.doorNodes[p.id], 'walk', distance, Math.max(1, distance / 1.2), 0, unknown)
      }
    }
    d.platforms.push(platform)
    service.stops.push({ stationId, platformId, minutesFromPrevious: service.stops.length === 0 ? 0 : 3 })
  }
  d.services.push(service)
}
const errors = validateDataset(d)
if (errors.length) throw new Error(errors.join('\n'))
writeFileSync('src/data/demo-network.json', JSON.stringify(d, null, 2) + '\n', 'utf8')
// These are generated synthetic examples, not a destination for survey data.
mkdirSync('src/data/demo-tables', { recursive: true })
const metadata = Object.fromEntries(Object.entries(d).filter(([key]) => !tableNames.includes(key as typeof tableNames[number])))
writeFileSync('src/data/demo-tables/metadata.json', JSON.stringify(metadata, null, 2) + '\n', 'utf8')
for (const table of tableNames) writeFileSync(`src/data/demo-tables/${table}.csv`, toCsv(d[table] as unknown as Record<string, unknown>[]), 'utf8')
console.log(`Wrote synthetic dataset: ${d.stations.length} stations, ${d.platforms.length} directional platforms, ${d.walkEdges.length} indoor edges.`)
