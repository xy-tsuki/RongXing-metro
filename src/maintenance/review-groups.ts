import type { FieldChange } from './catalog'

export interface ReviewGroup { id: string; entity: FieldChange['entity']; key: string; title: string; changes: FieldChange[] }

/** Groups presentation only: every original field ID remains independently reviewable. */
export function reviewGroups(changes: FieldChange[]): ReviewGroup[] {
  const groups = new Map<string, ReviewGroup>()
  for (const change of changes.filter(c => !c.decision)) {
    let label = change.entity === 'facilities' ? '设施记录' : change.entity === 'transfers' ? '换乘记录' : change.entity === 'navigation' ? '完整站内通路' : '站台资料'
    if (change.entity === 'rows') {
      const staircase = change.field.match(/^(?:楼梯([123])对应车厢车门|([123])是否有上行扶梯|距([123])最近出入口)$/)
      const transfer = change.field.match(/^换乘(?:线路|路程与时间|描述)([12])/)
      if (staircase) label = `楼梯 ${staircase[1] || staircase[2] || staircase[3]}`
      else if (change.field === '电梯对应车厢车门') label = '电梯'
      else if (transfer) label = `换乘 ${transfer[1]}`
    }
    const id = JSON.stringify([change.entity, change.key, label])
    if (!groups.has(id)) groups.set(id, { id, entity: change.entity, key: change.key, title: label, changes: [] })
    groups.get(id)!.changes.push(change)
  }
  return [...groups.values()]
}

export function reviewValue(field: string, value: unknown): string {
  if (value === '' || value === null || value === undefined) return '未填写'
  if (typeof value !== 'string') return JSON.stringify(value)
  if ((field === '车门' || field.includes('对应车厢车门')) && /^\d+\s*:\s*\d+(?:\s*[;；、,，]\s*\d+\s*:\s*\d+)*$/.test(value.trim())) {
    return value.split(/[;；、,，]/).map(position => { const [car, door] = position.trim().split(/\s*:\s*/); return `${car}车${door}门` }).join('、')
  }
  if (/路程与时间|路程时间/.test(field) && /^\d+(?:\.\d+)?\s*[,，]\s*\d+(?:\.\d+)?$/.test(value.trim())) {
    const [metres, minutes] = value.split(/[,，]/).map(part => part.trim())
    return `${metres} 米 · ${minutes} 分钟`
  }
  return value
}
