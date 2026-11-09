import type { Update } from './catalog'

export const facilityTypes = ['楼梯', '电梯'] as const
export type CollectionFacilityType = typeof facilityTypes[number]
export const escalatorChoices = ['未知', '是', '否'] as const
export interface FacilityEntry {
  mode: 'quick' | 'detail'; rowKey: string; type: CollectionFacilityType
  doors: string; escalator: typeof escalatorChoices[number]; group: number
  facilityId: string; nearestExit: string; description: string
}
/** Build collection evidence, not station geometry or navigation recommendations. */
export function facilityEntryUpdate(entry: FacilityEntry): Update {
  if (!facilityTypes.includes(entry.type)) throw new Error('请选择楼梯或电梯')
  const stairs = entry.type === '楼梯', doors = entry.doors.trim()
  const knownEscalator = stairs && entry.escalator !== '未知'
  if (!doors && !knownEscalator && (entry.mode === 'quick' || !entry.description.trim() && !entry.nearestExit.trim())) throw new Error('请至少填写一项实际采集信息')
  if (entry.mode === 'quick') {
    if (stairs && (!Number.isInteger(entry.group) || entry.group < 1 || entry.group > 3)) throw new Error('请选择第1至第3组楼梯')
    const values: Record<string,string> = {}
    if (doors) values[stairs ? `楼梯${entry.group}对应车厢车门` : '电梯对应车厢车门'] = doors
    if (stairs) values[`${entry.group}是否有上行扶梯`] = entry.escalator
    return { entity: 'rows', key: entry.rowKey, values }
  }
  const id = entry.facilityId.trim()
  if (!id) throw new Error('请填写稳定设施编号；修改已有设施请沿用同一编号')
  return { entity: 'facilities', key: `${entry.rowKey}/${id}`, values: {
    rowKey: entry.rowKey, 编号: id, 类型: entry.type, 车门: doors,
    ...(stairs ? { 上行扶梯: entry.escalator } : {}),
    最近出入口: entry.nearestExit.trim(), 描述: entry.description.trim(),
  } }
}
