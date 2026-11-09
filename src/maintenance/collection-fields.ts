/** Use the collector's local calendar day, not the UTC day at midnight. */
export function collectionDate(now = new Date()): string {
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}
/** Keep the existing free-text field contract; no exit IDs or station topology are invented. */
export function exitEntries(value: string): string[] {
  return value.split('、').map(item => item.trim()).filter(Boolean)
}
export function appendExit(value: string, input: string): string {
  const name = input.trim()
  if (!name) throw new Error('请填写出入口名称，如 A口')
  if (name.includes('、')) throw new Error('请一次添加一个出入口')
  const entries = exitEntries(value)
  if (entries.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('这个出入口已经添加')
  const result = [...entries, name].join('、')
  if (result.length > 300) throw new Error('出入口记录过长，请缩短名称')
  return result
}
