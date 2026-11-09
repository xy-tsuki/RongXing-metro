import { positions, type Values } from './catalog'

export function staircaseGroups(row: Values = {}): number[] {
  return [1, 2, 3].filter(group => [
    row[`楼梯${group}对应车厢车门`], row[`${group}是否有上行扶梯`], row[`距${group}最近出入口`],
  ].some(value => !!value?.trim() && value !== '【清空】' && value !== '未知'))
}

export function doorEntries(value: string) {
  return value.trim() ? positions(value, Number.MAX_SAFE_INTEGER) : []
}

export function appendDoor(value: string, car: string, door: string): string {
  if (!/^[1-9]\d*$/.test(car.trim()) || !/^[1-9]\d*$/.test(door.trim()) ||
      !Number.isSafeInteger(Number(car)) || !Number.isSafeInteger(Number(door))) {
    throw new Error('请分别填写大于 0 的整数车厢号和车门号')
  }
  const entries = doorEntries(value)
  const next = { car: Number(car), door: Number(door) }
  if (entries.some(entry => entry.car === next.car && entry.door === next.door)) throw new Error('这个车厢车门已经登记')
  return [...entries, next].map(entry => `${entry.car}:${entry.door}`).join(';')
}
