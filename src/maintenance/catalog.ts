import type { MetroDataset } from '../core/types'
import { parsePositions } from './station-patch'

/** The existing 28-column sheet remains the human collection contract. */
export const headers = ['车站', '所属线路', '运行方向（终点站）',
  '楼梯1对应车厢车门', '1是否有上行扶梯', '距1最近出入口',
  '楼梯2对应车厢车门', '2是否有上行扶梯', '距2最近出入口',
  '楼梯3对应车厢车门', '3是否有上行扶梯', '距3最近出入口',
  '电梯对应车厢车门', '是否可换乘', '换乘线路1',
  '换乘路程与时间1（快速）（m,min）', '换乘路程与时间1（扶梯）（m,min）', '换乘路程与时间1（无障碍）（m,min）',
  '换乘描述1（快速）', '换乘描述1（扶梯）', '换乘描述1（无障碍）', '换乘线路2',
  '换乘路程与时间2（快速）（m,min）', '换乘路程与时间2（扶梯）（m,min）', '换乘路程与时间2（无障碍）（m,min）',
  '换乘描述2（快速）', '换乘描述2（扶梯）', '换乘描述2（无障碍）'] as const
export type Entity = 'rows' | 'facilities' | 'transfers'
export type Values = Record<string, string>
export interface Update { entity: Entity; key: string; values: Values }
export interface Catalog {
  revision: number; dataset: MetroDataset
  rows: Record<string, Values>; facilities: Record<string, Values>; transfers: Record<string, Values>
}
export interface FieldChange {
  id: string; entity: Entity | 'navigation'; key: string; field: string
  before: unknown; after: unknown; base?: unknown
  kind: 'new' | 'modified' | 'conflict'; decision?: 'accepted' | 'rejected'
  details?: { field: string; before: unknown; after: unknown }[]
}
export const rowKey = (stationId: string, serviceId: string) => JSON.stringify([stationId, serviceId])
/** Explicit external transfers keep separate station IDs; never merge by display name. */
export function transferStationIds(data: Pick<MetroDataset, 'externalTransfers'>, stationId: string): Set<string> {
  return new Set([stationId, ...(data.externalTransfers ?? []).flatMap(t => t.fromStationId === stationId ? [t.toStationId] : t.bidirectional && t.toStationId === stationId ? [t.fromStationId] : [])])
}
export function createCatalog(dataset: MetroDataset): Catalog {
  const catalog: Catalog = { revision: 0, dataset: JSON.parse(JSON.stringify(dataset)), rows: {}, facilities: {}, transfers: {} }
  for (const service of dataset.services) for (const stop of service.stops) {
    const station = dataset.stations.find(s => s.id === stop.stationId)!
    const line = dataset.lines.find(l => l.id === service.lineId)!
    const targets = transferStationIds(dataset, station.id)
    const others = dataset.lines.filter(l => l.id !== line.id && dataset.services.some(s => s.lineId === l.id && s.stops.some(p => targets.has(p.stationId))))
    catalog.rows[rowKey(station.id, service.id)] = {
      车站: station.name, 所属线路: line.name, '运行方向（终点站）': service.direction,
      是否可换乘: others.length ? '是' : '否', ...Object.fromEntries(others.slice(0, 2).map((l, i) => [`换乘线路${i + 1}`, l.name]))
    }
  }
  return catalog
}
export function resolveRow(data: MetroDataset, values: Values): string {
  const candidates = data.services.flatMap(s => s.stops.filter(p => {
    const station = data.stations.find(x => x.id === p.stationId)!
    return station.name === values.车站 && data.lines.find(l => l.id === s.lineId)?.name === values.所属线路 && s.direction === values['运行方向（终点站）']
  }).map(p => rowKey(p.stationId, s.id)))
  if (candidates.length !== 1) throw new Error('车站、线路和运行方向必须唯一匹配现有线网；新增线网须另行维护')
  return candidates[0]
}
export function positions(text: string, cars: number) {
  // Accept the documented compact syntax and natural Chinese notation, never infer door counts.
  const normalized = text.replace(/(\d+)\s*(?:号?车厢|车)\s*(\d+)\s*(?:号?车门|门)/g, '$1:$2').replace(/[、,，]/g, ';')
  const result = parsePositions(normalized)
  if (!result.length || result.some(p => !Number.isInteger(p.car) || p.car < 1 || p.car > cars || !Number.isInteger(p.door) || p.door < 1)) throw new Error(`车门须填写 车厢:车门，多组用分号分隔，车厢范围 1–${cars}`)
  if (new Set(result.map(p => `${p.car}:${p.door}`)).size !== result.length) throw new Error('同组推荐车门重复')
  return result
}
export function validateUpdate(state: Catalog, update: Update): string[] {
  const errors: string[] = []
  if (!update || !['rows', 'facilities', 'transfers'].includes(update.entity) || typeof update.key !== 'string' || !update.values || typeof update.values !== 'object' || Array.isArray(update.values)) return ['更新格式无效']
  const values = update.values
  if (Object.keys(values).length > 40 || Object.values(values).some(v => typeof v !== 'string' || v.length > 3000)) return ['字段须为文本且不超过 3000 字']
  let key = update.key
  if (update.entity !== 'rows') key = values.rowKey
  const identity = state.rows[key]
  if (!identity) return ['引用的车站/线路/方向不存在']
  const [stationId, serviceId] = JSON.parse(key) as string[]
  const service = state.dataset.services.find(s => s.id === serviceId)!
  const cars = state.dataset.formations.find(f => f.id === service.formationId)!.cars
  const targetStations = transferStationIds(state.dataset, stationId)
  const allowed = update.entity === 'rows' ? [...headers] : update.entity === 'facilities'
    ? ['rowKey', '编号', '类型', '车门', '上行扶梯', '最近出入口', '描述']
    : ['rowKey', '目标方向ID', '快速路程时间', '扶梯路程时间', '无障碍路程时间', '快速描述', '扶梯描述', '无障碍描述']
  for (const [field, value] of Object.entries(values)) {
    if (!(allowed as readonly string[]).includes(field)) errors.push(`未知字段：${field}`)
    if (!value || value === '【清空】') continue
    try {
      if (/对应车厢车门/.test(field) || field === '车门') positions(value, cars)
      if (/是否有上行扶梯/.test(field) || field === '上行扶梯' || field === '是否可换乘') if (!['是', '否', '未知'].includes(value)) throw new Error('请填写 是、否 或 未知')
      if (/路程与时间|路程时间/.test(field)) {
        if (!/^\d+(?:\.\d+)?\s*[,，]\s*\d+(?:\.\d+)?$/.test(value)) throw new Error('请填写 米,分钟，例如 120,3；未知留空')
        const [metres, minutes] = value.split(/[,，]/).map(Number)
        if (!Number.isFinite(metres) || !Number.isFinite(minutes) || minutes <= 0) throw new Error('距离须非负、分钟须大于 0')
      }
      if (/^换乘线路[12]$/.test(field)) {
        const line = state.dataset.lines.find(l => l.name === value)
        if (!line || line.id === service.lineId || !state.dataset.services.some(s => s.lineId === line.id && s.stops.some(p => targetStations.has(p.stationId)))) throw new Error('换乘目标须为本站或已建模出站换乘的另一条线路')
      }
    } catch (e) { errors.push(`${field}：${(e as Error).message}`) }
  }
  if (update.entity === 'rows') {
    for (const h of headers.slice(0, 3)) if (values[h] !== undefined && values[h] !== identity[h]) errors.push(`不可更改记录身份：${h}`)
    const effective = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, v === '【清空】' ? '' : v]))
    const combined = { ...identity, ...effective }
    if (combined.换乘线路1 && combined.换乘线路1 === combined.换乘线路2) errors.push('两组换乘线路重复')
    if (combined.是否可换乘 === '否' && (combined.换乘线路1 && combined.换乘线路1 !== '【清空】' || combined.换乘线路2 && combined.换乘线路2 !== '【清空】')) errors.push('不可换乘与换乘线路冲突')
    for (const i of [1, 2]) if (!combined[`换乘线路${i}`] || combined[`换乘线路${i}`] === '【清空】') {
      if (Object.entries(combined).some(([h, v]) => new RegExp(`^换乘(?:描述|路程与时间)${i}`).test(h) && v && v !== '【清空】')) errors.push(`第 ${i} 组换乘摘要缺少目标线路`)
    }
  } else {
    if (values.rowKey !== state[update.entity][update.key]?.rowKey && state[update.entity][update.key]) errors.push('明细不能改变所属站台方向')
    if (update.entity === 'facilities') {
      if (!values.编号?.trim() || !['楼梯', '扶梯', '电梯'].includes(values.类型)) errors.push('设施编号与类型必填')
      if (update.key !== `${key}/${values.编号}`) errors.push('设施键与编号不匹配')
    } else {
      const target = state.dataset.services.find(s => s.id === values.目标方向ID)
      if (!target || target.lineId === service.lineId || !target.stops.some(p => targetStations.has(p.stationId))) errors.push('目标运行方向须属于本站或已建模出站换乘的其他线路')
      if (update.key !== `${key}/${values.目标方向ID}`) errors.push('换乘键与目标方向不匹配')
    }
  }
  return errors
}
export function compareUpdates(state: Catalog, updates: Update[], base?: Catalog): FieldChange[] {
  const seen = new Set<string>(), changes: FieldChange[] = []
  for (const update of updates) {
    const id = `${update.entity}:${update.key}`
    if (seen.has(id)) throw new Error('存在重复记录，请先合并重复行')
    seen.add(id)
    const errors = validateUpdate(state, update)
    if (errors.length) throw new Error(`${state.rows[update.key]?.车站 ?? update.key}：${errors.join('\n')}`)
    for (const [field, raw] of Object.entries(update.values)) {
      if (raw === '') continue // Blank is unknown, never an implicit deletion.
      const after = raw === '【清空】' ? '' : raw
      const before = state[update.entity][update.key]?.[field] ?? ''
      const baseline = base?.[update.entity][update.key]?.[field] ?? ''
      if (after === before || base && after === baseline) continue
      changes.push({ id: `field-${changes.length}`, entity: update.entity, key: update.key, field, before, after, base: base ? baseline : undefined,
        kind: raw === '【清空】' || (base ? before !== baseline : before !== '') ? 'conflict' : before === '' ? 'new' : 'modified' })
    }
  }
  return changes
}
