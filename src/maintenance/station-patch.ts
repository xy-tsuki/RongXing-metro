import type { MetroDataset, Provenance, WalkEdge, WalkNode } from '../core/types'
import { validateDataset } from '../core/validation'

export interface StationNodeRow {
  label: string; line?: string; direction?: string; level: number; kind: WalkNode['kind'];
  knowledge: WalkNode['knowledge']; car?: number; door?: number; longitudinalMetres?: number
}
export interface StationPathRow {
  from: string; to: string; kind: WalkEdge['kind']; metres: number; seconds: number; stairCount: number;
  wheelchair: WalkEdge['wheelchair']; bidirectional: boolean; knowledge: WalkEdge['knowledge']
}
export interface ManualRow {
  label: string; line: string; direction: string; purpose: 'transfer' | 'exit';
  targetLine?: string; targetDirection?: string; positions: { car: number; door: number }[]; note: string
}
/** User-facing names only. Internal IDs are resolved at merge time. Blank fields never invent evidence. */
export interface StationPatch {
  format: 'station-entry/1'; station: string; provenance: Provenance;
  nodes: StationNodeRow[]; paths: StationPathRow[]; manualRecommendations: ManualRow[]
}
export interface MergeResult { data: MetroDataset | null; errors: string[]; summary: string[] }
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const idPart = (s: string) => encodeURIComponent(s)
const nodeId = (stationId: string, label: string) => `entry:${idPart(stationId)}:node:${idPart(label)}`
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const positiveInteger = (n: unknown) => finite(n) && Number.isInteger(n) && Number(n) > 0
const blank = (s: unknown) => typeof s !== 'string' || !s.trim()
const kinds = ['concourse', 'facility', 'door', 'corridor']
const pathKinds = ['walk', 'stairs', 'escalator', 'lift']

export function stationServices(data: MetroDataset, station: string) {
  const found = data.stations.find(s => s.name === station || s.id === station)
  return found ? data.services.filter(s => s.stops.some(stop => stop.stationId === found.id)) : []
}
export function emptyStationPatch(data: MetroDataset, station: string): StationPatch {
  const found = data.stations.find(s => s.name === station || s.id === station)
  if (!found) throw new Error('请选择数据集中的车站')
  return { format: 'station-entry/1', station: found.name, provenance: { kind: data.provenance.kind === 'demo' ? 'demo' : 'survey', source: '', recordedAt: '' }, nodes: [], paths: [], manualRecommendations: [] }
}
function serviceFor(data: MetroDataset, station: string, line?: string, direction?: string) {
  return stationServices(data, station).filter(s => {
    const l = data.lines.find(l => l.id === s.lineId)
    return (l?.name === line || l?.id === line) && s.direction === direction
  })
}
/** Descriptive validation happens before mutation. Existing input is never modified on errors. */
export function validateStationPatch(data: MetroDataset, input: unknown): string[] {
  const errors: string[] = [], p = input as StationPatch
  if (!p || p.format !== 'station-entry/1' || !Array.isArray(p.nodes) || !Array.isArray(p.paths) || !Array.isArray(p.manualRecommendations)) return ['不是 station-entry/1 单站录入文件']
  const station = data.stations.find(s => s.name === p.station)
  if (!station) return ['车站名称不在当前线网中；请从列表重新选择']
  if (!p.provenance || !['survey', 'user', 'official', 'demo'].includes(p.provenance.kind) || blank(p.provenance.source) || !/^\d{4}-\d{2}-\d{2}$/.test(p.provenance.recordedAt)) errors.push('请填写来源、来源类型及 YYYY-MM-DD 核实日期')
  else {
    const date = new Date(`${p.provenance.recordedAt}T00:00:00Z`)
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== p.provenance.recordedAt) errors.push('核实日期不是有效日历日期')
  }
  if (!p.nodes.length && !p.paths.length && !p.manualRecommendations.length) errors.push('至少填写一个节点、通路或人工对照记录')
  const existing = data.walkNodes.filter(n => n.stationId === station.id)
  const labels = new Set(existing.map(n => n.label)), newLabels = new Set<string>(), submittedDoorSlots = new Set<string>()
  for (const [i, n] of p.nodes.entries()) {
    const prefix = `节点第 ${i + 1} 行`
    if (!n || blank(n.label) || newLabels.has(n.label) || !finite(n.level) || !kinds.includes(n.kind) || !['confirmed', 'unknown'].includes(n.knowledge)) { errors.push(`${prefix}：名称不可重复，楼层/类别/确认状态必填`); continue }
    newLabels.add(n.label); labels.add(n.label)
    if (existing.filter(x => x.label === n.label).length > 1) errors.push(`${prefix}：原数据有同名节点，请改用独立名称`)
    const oldNode = existing.find(x => x.label === n.label)
    if (oldNode && oldNode.kind !== n.kind) errors.push(`${prefix}：已有节点类别不可直接改变；请使用新名称并重新录入通路，避免继承旧路径`)
    if (n.line || n.direction || n.kind === 'door') {
      const services = serviceFor(data, p.station, n.line, n.direction)
      if (services.length !== 1) errors.push(`${prefix}：请选择唯一的线路与运行方向`)
      else if (n.kind === 'door') {
        const formation = data.formations.find(f => f.id === services[0].formationId)!
        if (!positiveInteger(n.car) || Number(n.car) > formation.cars || !positiveInteger(n.door)) errors.push(`${prefix}：车厢须为 1–${formation.cars}，车门须填写现场确认的正整数编号`)
        if (n.longitudinalMetres !== undefined && (!finite(n.longitudinalMetres) || n.longitudinalMetres < 0)) errors.push(`${prefix}：纵向米数须为非负数，未知请留空`)
        const stop = services[0].stops.find(s => s.stationId === station.id)!
        const platform = data.platforms.find(p => p.id === stop.platformId)
        if (platform && Object.keys(platform.doorNodes).length && platform.level !== n.level) errors.push(`${prefix}：同方向已有站台楼层为 ${platform.level}，不能混用不同楼层`)
        const targetPlatformId = platform?.id ?? `entry:${idPart(station.id)}:platform:${idPart(services[0].id)}`
        const position = formation.positions.find(pos => pos.car === n.car && pos.door === n.door)
        const slot = `${targetPlatformId}|${n.car}:${n.door}`
        if (submittedDoorSlots.has(slot)) errors.push(`${prefix}：同一方向的同一车厢/车门只能使用一个节点名称`)
        submittedDoorSlots.add(slot)
        if (oldNode?.kind === 'door') {
          const bindings = data.platforms.filter(p => p.stationId === station.id).flatMap(p => Object.entries(p.doorNodes).filter(([, id]) => id === oldNode.id).map(([positionId]) => ({ platformId: p.id, positionId })))
          if (!bindings.length || bindings.some(b => b.platformId !== targetPlatformId || b.positionId !== position?.id) || oldNode.platformId !== undefined && oldNode.platformId !== targetPlatformId) errors.push(`${prefix}：已有车门的站台/方向或车厢门号归属不可改变；换方向或门位请使用新名称并重新录入通路`)
        }
        const occupiedNodeId = position && platform?.doorNodes[position.id]
        if (occupiedNodeId && occupiedNodeId !== oldNode?.id) {
          const occupied = existing.find(n => n.id === occupiedNodeId)
          errors.push(`${prefix}：该方向 ${n.car}车${n.door}门已绑定“${occupied?.label ?? occupiedNodeId}”，请复用原名称，不能用新别名覆盖`)
        }
      }
    }
  }
  for (const [i, e] of p.paths.entries()) {
    if (!e || !labels.has(e.from) || !labels.has(e.to) || e.from === e.to || !pathKinds.includes(e.kind) || !finite(e.metres) || e.metres < 0 || !finite(e.seconds) || e.seconds <= 0 || !Number.isInteger(e.stairCount) || e.stairCount < 0 || !['confirmed', 'blocked', 'unknown'].includes(e.wheelchair) || !['confirmed', 'unknown'].includes(e.knowledge) || typeof e.bidirectional !== 'boolean') errors.push(`通路第 ${i + 1} 行：请检查节点、距离、正数耗时、方向与确认状态`)
    if (e && ((e.kind === 'stairs') !== (e.stairCount > 0))) errors.push(`通路第 ${i + 1} 行：普通楼梯须填写级数，其他通路楼梯数为 0`)
    if (e && [e.from, e.to].some(label => existing.filter(n => n.label === label).length > 1)) errors.push(`通路第 ${i + 1} 行：已有节点重名，请先使用不重复的新名称录入所需位置`)
  }
  for (const [i, r] of p.manualRecommendations.entries()) {
    const service = serviceFor(data, p.station, r?.line, r?.direction)
    const f = data.formations.find(f => f.id === service[0]?.formationId)
    if (!r || blank(r.label) || service.length !== 1 || !['exit', 'transfer'].includes(r.purpose) || !Array.isArray(r.positions) || !r.positions.length || r.positions.some(x => !x || !positiveInteger(x.car) || x.car > (f?.cars ?? 0) || !positiveInteger(x.door))) errors.push(`人工对照第 ${i + 1} 行：请检查名称、线路方向及已核实的车厢/车门`)
    if (r?.purpose === 'transfer' && serviceFor(data, p.station, r.targetLine, r.targetDirection).length !== 1) errors.push(`人工对照第 ${i + 1} 行：换乘目标线路与方向必填`)
  }
  return errors
}

export function mergeStationPatch(data: MetroDataset, patch: StationPatch): MergeResult {
  const errors = validateStationPatch(data, patch)
  if (errors.length) return { data: null, errors, summary: [] }
  const next = copy(data), station = next.stations.find(s => s.name === patch.station)!
  const refs = new Map(next.walkNodes.filter(n => n.stationId === station.id).map(n => [n.label, n.id]))
  const upsert = <T extends { id: string }>(list: T[], row: T) => { const i = list.findIndex(x => x.id === row.id); if (i < 0) list.push(row); else list[i] = row }
  for (const row of patch.nodes) {
    const id = refs.get(row.label) ?? nodeId(station.id, row.label)
    refs.set(row.label, id)
    upsert(next.walkNodes, { id, stationId: station.id, label: row.label, level: row.level, kind: row.kind, knowledge: row.knowledge, provenance: patch.provenance })
    // Reclassifying an existing node cannot leave stale hall or door references behind.
    station.concourseNodeIds = station.concourseNodeIds.filter(x => x !== id)
    for (const p of next.platforms) if (p.stationId === station.id) for (const [key, value] of Object.entries(p.doorNodes)) if (value === id) delete p.doorNodes[key]
    if (row.kind === 'concourse') station.concourseNodeIds.push(id)
    if (row.kind !== 'door') continue
    const service = serviceFor(next, patch.station, row.line, row.direction)[0]
    const stop = service.stops.find(s => s.stationId === station.id)!, f = next.formations.find(f => f.id === service.formationId)!
    let platform = next.platforms.find(p => p.id === stop.platformId)
    if (!platform) {
      const platformId = `entry:${idPart(station.id)}:platform:${idPart(service.id)}`
      platform = { id: platformId, stationId: station.id, lineId: service.lineId, level: row.level, doorNodes: {}, provenance: copy(patch.provenance) }
      next.platforms.push(platform); stop.platformId = platformId
    }
    platform.level = row.level
    const doorNode = next.walkNodes.find(n => n.id === id)!
    doorNode.platformId = platform.id
    let position = f.positions.find(x => x.car === row.car && x.door === row.door)
    if (!position) {
      position = { id: `observed:${idPart(f.id)}:${row.car}:${row.door}`, car: row.car!, door: row.door!, longitudinalMetres: row.longitudinalMetres ?? null }
      f.positions.push(position)
    }
    if (row.knowledge === 'confirmed') position.numberingConfirmed = true
    // Observing selected positions does not establish total door count or numbering convention.
    platform.doorNodes[position.id] = id
  }
  // Only assign a facility to a platform when its selected direction and floor actually match.
  // Elevator ends on other floors stay ordinary station nodes linked by the surveyed edges.
  for (const row of patch.nodes) if (row.kind === 'facility' && row.line && row.direction) {
    const service = serviceFor(next, patch.station, row.line, row.direction)[0]
    const stop = service?.stops.find(s => s.stationId === station.id)
    const platform = next.platforms.find(p => p.id === stop?.platformId)
    const node = next.walkNodes.find(n => n.id === refs.get(row.label))!
    if (platform && platform.level === node.level) node.platformId = platform.id
  }
  for (const row of patch.paths) {
    const from = refs.get(row.from)!, to = refs.get(row.to)!
    const id = `entry:${idPart(station.id)}:path:${idPart(row.from)}:${idPart(row.to)}:${row.kind}`
    upsert(next.walkEdges, { id, ...row, from, to, provenance: copy(patch.provenance) })
  }
  for (const row of patch.manualRecommendations) {
    const service = serviceFor(next, patch.station, row.line, row.direction)[0]
    const targetServiceId = row.purpose === 'transfer' ? serviceFor(next, patch.station, row.targetLine, row.targetDirection)[0].id : undefined
    next.manualRecommendations ??= []
    upsert(next.manualRecommendations, { id: `entry:${idPart(station.id)}:manual:${idPart(row.label)}`, stationId: station.id, serviceId: service.id, purpose: row.purpose, targetServiceId, positions: copy(row.positions), note: row.note, provenance: copy(patch.provenance) })
  }
  station.indoorData = 'partial' // A single submitted portion never establishes complete station coverage.
  if (patch.provenance.kind === 'demo') {
    next.provenance = { ...patch.provenance, source: `混合演示副本（含合成站内资料）：${patch.provenance.source}` }
    next.description = `【含演示站内资料，禁止用于实际导航】${next.description}`
  }
  next.version = `${data.version.replace(/\+entry.*$/, '')}+entry-${patch.provenance.recordedAt}`
  const fullErrors = validateDataset(next)
  if (fullErrors.length) return { data: null, errors: fullErrors, summary: [] }
  return { data: next, errors: [], summary: [`${patch.station}：${patch.nodes.length} 个节点、${patch.paths.length} 条通路、${patch.manualRecommendations.length} 条人工对照已合并`, '全站覆盖仍为部分资料；缺失区域不自动补全，也不视为完整无障碍导航。'] }
}

const headers = ['记录类型', '名称', '线路', '运行方向', '楼层', '节点类型', '车厢', '车门', '纵向米数', '起点', '终点', '通行类型', '距离米', '耗时秒', '楼梯数', '轮椅通行', '双向', '确认状态', '用途', '目标线路', '目标方向', '等价位置', '备注', '来源类型', '来源', '核实日期', '车站'] as const
const csvCell = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`
export function exportStationTemplate(data: MetroDataset, station: string): string { return stationPatchToCsv(emptyStationPatch(data, station)) }
export function stationPatchToCsv(patch: StationPatch): string {
  const rows: Record<string, unknown>[] = [{ 记录类型: '资料', 车站: patch.station, 来源类型: patch.provenance.kind, 来源: patch.provenance.source, 核实日期: patch.provenance.recordedAt }]
  for (const n of patch.nodes) rows.push({ 记录类型: '节点', 名称: n.label, 线路: n.line, 运行方向: n.direction, 楼层: n.level, 节点类型: n.kind, 车厢: n.car, 车门: n.door, 纵向米数: n.longitudinalMetres, 确认状态: n.knowledge })
  for (const e of patch.paths) rows.push({ 记录类型: '通路', 起点: e.from, 终点: e.to, 通行类型: e.kind, 距离米: e.metres, 耗时秒: e.seconds, 楼梯数: e.stairCount, 轮椅通行: e.wheelchair, 双向: e.bidirectional ? '是' : '否', 确认状态: e.knowledge })
  for (const r of patch.manualRecommendations) rows.push({ 记录类型: '人工对照', 名称: r.label, 线路: r.line, 运行方向: r.direction, 用途: r.purpose, 目标线路: r.targetLine, 目标方向: r.targetDirection, 等价位置: r.positions.map(x => `${x.car}:${x.door}`).join(';'), 备注: r.note })
  return '\uFEFF' + [headers, ...rows.map(r => headers.map(h => r[h]))].map(row => row.map(csvCell).join(',')).join('\r\n')
}
/** RFC4180 cells, including Chinese labels, commas, quoted text and CRLF. */
function csvRows(text: string): string[][] {
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { row.push(cell); cell = '' }
    else if ((c === '\r' || c === '\n') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push([...row]); row.length = 0; cell = '' }
    else cell += c
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  row.push(cell); if (row.some(x => x.trim())) rows.push(row)
  return rows
}
export function parseStationCsv(text: string): StationPatch {
  const [head, ...lines] = csvRows(text)
  if (!head || headers.some(h => !head.includes(h))) throw new Error('请使用本工具生成的单站 CSV 模板（缺少列）')
  if (lines.some(row => row.length !== head.length)) throw new Error('CSV 列数不一致，请勿删除逗号或表头')
  const rows = lines.map(line => Object.fromEntries(head.map((h, i) => [h, line[i]?.trim() ?? ''])))
  const meta = rows.filter(r => r.记录类型 === '资料')
  if (meta.length !== 1) throw new Error('每个文件必须且只能有一行「资料」')
  const p: StationPatch = { format: 'station-entry/1', station: meta[0].车站, provenance: { kind: meta[0].来源类型 as Provenance['kind'], source: meta[0].来源, recordedAt: meta[0].核实日期 }, nodes: [], paths: [], manualRecommendations: [] }
  const num = (v: string) => v === '' ? NaN : Number(v)
  for (const r of rows) {
    if (r.记录类型 === '资料') continue
    if (r.记录类型 === '节点') p.nodes.push({ label: r.名称, line: r.线路 || undefined, direction: r.运行方向 || undefined, level: num(r.楼层), kind: r.节点类型 as StationNodeRow['kind'], car: r.车厢 ? num(r.车厢) : undefined, door: r.车门 ? num(r.车门) : undefined, longitudinalMetres: r.纵向米数 ? num(r.纵向米数) : undefined, knowledge: r.确认状态 as WalkNode['knowledge'] })
    else if (r.记录类型 === '通路') p.paths.push({ from: r.起点, to: r.终点, kind: r.通行类型 as WalkEdge['kind'], metres: num(r.距离米), seconds: num(r.耗时秒), stairCount: num(r.楼梯数), wheelchair: r.轮椅通行 as WalkEdge['wheelchair'], bidirectional: r.双向 === '是' ? true : r.双向 === '否' ? false : undefined as unknown as boolean, knowledge: r.确认状态 as WalkNode['knowledge'] })
    else if (r.记录类型 === '人工对照') p.manualRecommendations.push({ label: r.名称, line: r.线路, direction: r.运行方向, purpose: r.用途 as ManualRow['purpose'], targetLine: r.目标线路 || undefined, targetDirection: r.目标方向 || undefined, positions: parsePositions(r.等价位置), note: r.备注 })
    else throw new Error(`未知记录类型：${r.记录类型}`)
  }
  return p
}
export function parsePositions(text: string): { car: number; door: number }[] {
  return text.split(/[;；\n]/).filter(x => x.trim()).map(pair => { const parts = pair.trim().split(/[:：]/); if (parts.length !== 2) throw new Error('等价位置请填写 车厢:车门，多组以分号分隔，例如 2:1;2:2（仅格式示例）'); return { car: Number(parts[0]), door: Number(parts[1]) } })
}
