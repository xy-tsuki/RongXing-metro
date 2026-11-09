import { positions, transferStationIds, type Catalog, type Update } from './catalog'

export const transferRouteTypes = [
  { key: '快速', title: '最近路线', hint: '记录实际步行较短的走法；说明是否经过楼梯。' },
  { key: '扶梯', title: '优先扶梯', hint: '记录优先使用扶梯的走法；仍需走楼梯的地方请写清楚。' },
  { key: '无障碍', title: '仅限电梯', hint: '记录连续电梯通路；未核实坡道、闸机或通道时，请在步骤中注明。' },
] as const
export interface TransferRouteDraft {
  label: typeof transferRouteTypes[number]['key']
  metres: string; minutes: string; fromDoors: string; description: string
  walk?: TransferWalkingDraft
}
export const verticalMoves = ['未知 / 未填写', '上楼', '下楼'] as const
export interface TransferWalkingDraft {
  startFacility: string; startMove: string; guideLine: string; special: string
  endFacility: string; endMove: string; side: string
}
export interface TransferWalkingTarget { line: string; direction: string }
export function emptyTransferRoutes(): TransferRouteDraft[] {
  return transferRouteTypes.map(r => ({ label: r.key, metres: '', minutes: '', fromDoors: '', description: '',
    walk: { startFacility:'', startMove:'', guideLine:'', special:'', endFacility:'', endMove:'', side:'' } }))
}
export const hasWalkingFields = (route: TransferRouteDraft) => !!route.walk && Object.values(route.walk).some(v => v.trim())
export const transferRouteHasEvidence = (route: TransferRouteDraft) => !!(route.metres || route.minutes || route.fromDoors || route.description || hasWalkingFields(route))
/** Display placeholders remain explicit unknowns, never defaults for a facility, direction or distance. */
export function transferWalkingText(route: TransferRouteDraft, target?: TransferWalkingTarget): string {
  const w = route.walk
  const known = (v: string | undefined, name: string) => v?.trim() || `[${name}待核实]`
  const distance = measurement(route.metres, '步行距离', false)
  if (w && ([w.startMove,w.endMove].some(v=>v && !['上楼','下楼'].includes(v)))) throw new Error('升降方向请选择上楼或下楼；未知留空')
  const side = w?.side.trim().replace(/侧$/, '')
  return `下车后，乘坐${known(w?.startFacility,'起始设施')}${known(w?.startMove,'升降方向')}，寻找${known(w?.guideLine,'指引线路')}换乘指引。\n`
    + `跟随指引步行${distance ? `${distance}米` : '[距离待核实]'}${w?.special.trim() ? `，${w.special.trim().replace(/[。\n]+$/,'')}` : ''}。\n`
    + `最后乘${known(w?.endFacility,'末段设施')}${known(w?.endMove,'升降方向')}，向${known(side,'方向')}侧进入${target ? `${target.line}（往${target.direction}）` : '[目标线路、方向待选择]'}站台。`
}
function measurement(raw: string, name: string, positive: boolean): string {
  const value = raw.trim()
  if (value && (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || positive && Number(value) <= 0)) throw new Error(`${name}请填写${positive ? '大于0的' : '非负'}数字；未知留空`)
  return value
}
/** Retain the legacy paired metric and descriptive evidence; never manufacture a missing measure. */
export function transferRouteValues(route: TransferRouteDraft, target?: TransferWalkingTarget): { metric: string; description: string } {
  const metres = measurement(route.metres, `${route.label}路线距离`, false)
  const minutes = measurement(route.minutes, `${route.label}路线耗时`, true)
  const parts = [route.fromDoors.trim() && `下车门位：${route.fromDoors.trim()}`,
    metres && !minutes && `已测距离：${metres}米；耗时未知`,
    minutes && !metres && `已测耗时：${minutes}分钟；距离未知`,
    hasWalkingFields(route) && transferWalkingText(route,target), route.description.trim()].filter(Boolean)
  const description = parts.join('\n')
  if (description.length > 3000) throw new Error('路线说明过长，请缩短行走步骤')
  return { metric: metres && minutes ? `${metres},${minutes}` : '', description }
}
export type TransferCatalog = Pick<Catalog, 'rows'> & { dataset: Pick<Catalog['dataset'], 'services' | 'lines' | 'externalTransfers'> & Partial<Pick<Catalog['dataset'], 'formations'>> }
export function transferEntryUpdates(catalog: TransferCatalog, rowKey: string, targetId: string, routes: TransferRouteDraft[]): Update[] {
  const current = catalog.rows[rowKey]
  if (!current) throw new Error('请选择有效的出发站台方向')
  const [stationId, serviceId] = JSON.parse(rowKey) as string[]
  const from = catalog.dataset.services.find(s => s.id === serviceId)
  const target = catalog.dataset.services.find(s => s.id === targetId)
  if (!from || !target || from.lineId === target.lineId || !target.stops.some(s => transferStationIds(catalog.dataset, stationId).has(s.stationId))) throw new Error('请选择本站或已建模出站换乘的目标线路与方向')
  if (routes.length !== 3 || new Set(routes.map(r => r.label)).size !== 3 || routes.some(r => !transferRouteTypes.some(t => t.key === r.label))) throw new Error('换乘路线类型无效')
  for (const route of routes) {
    if (route.fromDoors.trim()) positions(route.fromDoors, catalog.dataset.formations?.find(f => f.id === from.formationId)?.cars ?? Number.MAX_SAFE_INTEGER)
  }
  const targetLine = catalog.dataset.lines.find(l => l.id === target.lineId)!.name
  const values = routes.map(route=>transferRouteValues(route,{ line:targetLine, direction:target.direction }))
  if (!values.some(v => v.metric || v.description)) throw new Error('请至少填写一条路线的实测信息或行走步骤')
  const slot = current.换乘线路1 === targetLine ? 1 : current.换乘线路2 === targetLine ? 2 : !current.换乘线路1 ? 1 : !current.换乘线路2 ? 2 : 0
  const row: Record<string, string> = {}, detail: Record<string, string> = { rowKey, 目标方向ID: targetId }
  if (slot) { row[`换乘线路${slot}`] = targetLine; row.是否可换乘 = '是' }
  routes.forEach((route, i) => {
    const value = values[i]
    if (value.metric) { detail[`${route.label}路程时间`] = value.metric; if (slot) row[`换乘路程与时间${slot}（${route.label}）（m,min）`] = value.metric }
    if (value.description) { detail[`${route.label}描述`] = value.description; if (slot) row[`换乘描述${slot}（${route.label}）`] = value.description }
  })
  return [...(slot ? [{ entity: 'rows' as const, key: rowKey, values: row }] : []), { entity: 'transfers', key: `${rowKey}/${targetId}`, values: detail }]
}
