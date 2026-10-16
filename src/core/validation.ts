import type { MetroDataset } from './types'

/** Runtime validation at the import boundary; no browser APIs or external services. */
function validateStructure(input: unknown): string[] {
  const errors: string[] = []
  const d = input as MetroDataset
  const text = (value: unknown) => typeof value === 'string' && value.length > 0
  if (!d || typeof d !== 'object') return ['数据必须为 JSON 对象']
  if (d.schemaVersion !== '1.0') errors.push('不支持的 schemaVersion')
  const arrays = ['stations', 'lines', 'formations', 'platforms', 'services', 'walkNodes', 'walkEdges'] as const
  for (const key of arrays) if (!Array.isArray(d[key])) errors.push(`${key} 必须为数组`)
  if (errors.length) return errors
  const validProvenance = (p: MetroDataset['provenance']) => p && ['demo', 'survey', 'official', 'user'].includes(p.kind) && typeof p.source === 'string' && p.source.length > 0 && typeof p.recordedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.recordedAt)
  if (!text(d.city?.id) || !text(d.city?.name) || !text(d.version) || !text(d.description) || !validProvenance(d.provenance)) errors.push('缺少城市、版本或来源及采集日期信息')
  for (const key of arrays) {
    const ids = new Set<string>()
    for (const item of d[key]) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) errors.push(`${key}: 无效或重复 id`)
      if (item) ids.add(item.id)
    }
  }
  // Stop early before traversing malformed records.
  if (errors.length) return errors
  const stationIds = new Set(d.stations.map(x => x.id)), lineIds = new Set(d.lines.map(x => x.id))
  const nodes = new Map(d.walkNodes.map(x => [x.id, x])), platforms = new Map(d.platforms.map(x => [x.id, x]))
  const formations = new Map(d.formations.map(x => [x.id, x]))
  const nonnegative = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  for (const n of d.walkNodes) {
    if (!stationIds.has(n.stationId) || !Number.isFinite(n.level) || !text(n.label) || !['confirmed', 'unknown'].includes(n.knowledge) || !['concourse','facility','door','corridor'].includes(n.kind) || n.provenance && !validProvenance(n.provenance)) errors.push(`节点 ${n.id} 属性无效`)
    if (n.platformId !== undefined) { const platform = platforms.get(n.platformId); if (!platform || platform.stationId !== n.stationId || platform.level !== n.level) errors.push(`节点 ${n.id} 站台归属无效`) }
  }
  for (const s of d.stations) {
    if (!text(s.name) || !['complete', 'partial', 'missing'].includes(s.indoorData) || !Array.isArray(s.concourseNodeIds) || s.indoorData === 'complete' && !s.concourseNodeIds.length || s.concourseNodeIds.some(id => nodes.get(id)?.stationId !== s.id || nodes.get(id)?.kind !== 'concourse')) errors.push(`车站 ${s.id} 站厅入口或覆盖状态无效`)
  }
  for (const l of d.lines) if (!text(l.name) || !/^#[0-9a-f]{6}$/i.test(l.color)) errors.push(`线路 ${l.id} 名称或颜色无效`)
  for (const f of d.formations) {
    if (!Number.isInteger(f.cars) || f.cars < 1 || !Array.isArray(f.positions) || f.doorsKnown !== undefined && typeof f.doorsKnown !== 'boolean' || f.numberingStatus !== undefined && !['unknown','confirmed'].includes(f.numberingStatus)) { errors.push(`编组 ${f.id} 无效`); continue }
    const ids = new Set<string>(), pairs = new Set<string>()
    for (const p of f.positions) {
      const pair = `${p.car}:${p.door}`
      if (!text(p.id) || ids.has(p.id) || pairs.has(pair) || !Number.isInteger(p.car) || p.car < 1 || p.car > f.cars || !Number.isInteger(p.door) || p.door < 1 || p.longitudinalMetres !== null && !nonnegative(p.longitudinalMetres) || p.numberingConfirmed !== undefined && typeof p.numberingConfirmed !== 'boolean') errors.push(`编组 ${f.id} 车门无效`)
      ids.add(p.id); pairs.add(pair)
    }
  }
  for (const p of d.platforms) {
    if (!stationIds.has(p.stationId) || !lineIds.has(p.lineId) || !Number.isFinite(p.level) || !p.doorNodes || typeof p.doorNodes !== 'object' || p.provenance && !validProvenance(p.provenance)) { errors.push(`站台 ${p.id} 无效`); continue }
    for (const id of Object.values(p.doorNodes)) if (nodes.get(id)?.stationId !== p.stationId || nodes.get(id)?.kind !== 'door' || nodes.get(id)?.level !== p.level) errors.push(`站台 ${p.id} 车门映射无效`)
  }
  for (const s of d.services) {
    const f = formations.get(s.formationId)
    if (!lineIds.has(s.lineId) || !f || !text(s.direction) || !Array.isArray(s.stops) || s.stops.length < 2) { errors.push(`运行交路 ${s.id} 无效`); continue }
    for (const stop of s.stops) {
      const p = stop.platformId == null ? undefined : platforms.get(stop.platformId)
      if (!stationIds.has(stop.stationId) || stop.platformId != null && (!p || p.stationId !== stop.stationId || p.lineId !== s.lineId) || stop.minutesFromPrevious != null && !nonnegative(stop.minutesFromPrevious)) errors.push(`运行交路 ${s.id} 停站无效`)
      if (p && f.doorsKnown !== false && d.stations.find(station => station.id === stop.stationId)?.indoorData === 'complete' && Array.isArray(f.positions) && f.positions.some(pos => !p.doorNodes?.[pos.id])) errors.push(`运行交路 ${s.id} 缺少编组车门映射`)
    }
    if (new Set(s.stops.map(x => x.stationId)).size !== s.stops.length) errors.push(`交路 ${s.id} 重复停站；环线需拆成交路`)
  }
  for (const e of d.walkEdges) {
    const a = nodes.get(e.from), b = nodes.get(e.to)
    if (!a || !b || a.stationId !== b.stationId || e.from === e.to) errors.push(`通行边 ${e.id} 节点无效`)
    if (!nonnegative(e.metres) || !nonnegative(e.seconds) || e.seconds === 0 || !Number.isInteger(e.stairCount) || e.stairCount < 0 || typeof e.bidirectional !== 'boolean' || !['confirmed', 'unknown'].includes(e.knowledge) || !['confirmed', 'blocked', 'unknown'].includes(e.wheelchair) || !['walk', 'stairs', 'escalator', 'lift'].includes(e.kind) || !validProvenance(e.provenance)) errors.push(`通行边 ${e.id} 属性无效（含必填轮椅通行确认 wheelchair）`)
    if (a && b && a.level !== b.level && e.kind === 'walk') errors.push(`通行边 ${e.id} 跨楼层不能标记为平路`)
    if ((e.kind === 'stairs') !== (e.stairCount > 0)) errors.push(`通行边 ${e.id} 楼梯数量不一致`)
  }
  if (d.manualRecommendations !== undefined) {
    if (!Array.isArray(d.manualRecommendations)) errors.push('manualRecommendations必须是数组')
    else for (const item of d.manualRecommendations) {
      const service = d.services.find(s => s.id === item.serviceId), formation = formations.get(service?.formationId ?? '')
      if (!text(item.id) || !stationIds.has(item.stationId) || !service?.stops.some(s => s.stationId === item.stationId) || item.targetServiceId !== undefined && !d.services.some(s => s.id === item.targetServiceId && s.stops.some(stop => stop.stationId === item.stationId)) || !['transfer','exit'].includes(item.purpose) || !text(item.note) || !validProvenance(item.provenance) || !Array.isArray(item.positions) || !item.positions.length || item.positions.some(p => !Number.isInteger(p.car) || p.car < 1 || p.car > (formation?.cars ?? 0) || !Number.isInteger(p.door) || p.door < 1)) errors.push(`人工对照 ${item.id} 无效`)
    }
  }
  if (d.externalTransfers !== undefined) {
    if (!Array.isArray(d.externalTransfers)) errors.push('externalTransfers必须是数组')
    else for (const link of d.externalTransfers) if (!text(link.id) || !stationIds.has(link.fromStationId) || !stationIds.has(link.toStationId) || link.fromStationId === link.toStationId || typeof link.bidirectional !== 'boolean' || link.walkingMetres !== null && !nonnegative(link.walkingMetres) || link.minutes !== null && !nonnegative(link.minutes) || !['confirmed','blocked','unknown'].includes(link.wheelchair) || !validProvenance(link.provenance)) errors.push(`出站换乘 ${link.id} 无效`)
  }
  return errors
}

export function validateDataset(input: unknown): string[] {
  try { return validateStructure(input) }
  catch { return ['数据包含无效的嵌套记录；请检查编组 positions、交路 stops、站台 doorNodes 和通行边字段。'] }
}

export function loadDataset(input: unknown): MetroDataset {
  const errors = validateDataset(input)
  if (errors.length) throw new Error(errors.join('\n'))
  return input as MetroDataset
}

/** UI loaders can render errors without allowing invalid JSON objects into routing. */
export function loadDatasetResult(input: unknown): { data: MetroDataset | null; errors: string[] } {
  const errors = validateDataset(input)
  return { data: errors.length ? null : input as MetroDataset, errors }
}
