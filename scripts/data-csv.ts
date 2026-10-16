/** Small RFC 4180-compatible CSV reader; cells may contain JSON for nested fields. */
export function parseCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = [], row: string[] = []
  let cell = '', quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"' && !cell.length) quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some(x => x.length)) rows.push([...row]); row.length = 0; cell = '' }
    else cell += char
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push([...row]) }
  const headers = rows.shift()
  if (!headers?.length || new Set(headers).size !== headers.length || headers.some(h => !h)) throw new Error('CSV 表头为空或重复')
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV 第${index + 2}行的列数与表头不符`)
    return Object.fromEntries(headers.map((key, col) => {
      const value = values[col]
      let parsed: unknown = value
      if (['bidirectional', 'doorsKnown'].includes(key) && (value === 'true' || value === 'false')) parsed = value === 'true'
      else if (value === 'null' && ['longitudinalMetres', 'minutesFromPrevious', 'walkingMetres', 'minutes'].includes(key)) parsed = null
      else if (['cars', 'car', 'door', 'longitudinalMetres', 'level', 'metres', 'seconds', 'stairCount'].includes(key) && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) parsed = Number(value)
      else if (value.startsWith('{') || value.startsWith('[')) parsed = JSON.parse(value)
      return [key, parsed]
    }))
  })
}
export function toCsv(records: Record<string, unknown>[], emptyHeaders?: string[]): string {
  if (!records.length && !emptyHeaders?.length) throw new Error('无法导出没有字段的空表')
  const headers = records.length ? [...new Set(records.flatMap(Object.keys))] : emptyHeaders!
  const encode = (value: unknown) => `"${(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replace(/"/g, '""')}"`
  return '\uFEFF' + [headers.map(encode).join(','), ...records.map(record => headers.map(key => encode(record[key])).join(','))].join('\r\n') + '\r\n'
}
export const tableNames = ['stations', 'lines', 'formations', 'platforms', 'services', 'walkNodes', 'walkEdges'] as const
