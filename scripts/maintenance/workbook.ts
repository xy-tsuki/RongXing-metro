import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import type { Catalog, Update, Values } from '../../src/maintenance/catalog'
import { headers, resolveRow } from '../../src/maintenance/catalog'

const facilityHeaders = ['rowKey', '编号', '类型', '车门', '上行扶梯', '最近出入口', '描述']
const transferHeaders = ['rowKey', '目标方向ID', '快速路程时间', '扶梯路程时间', '无障碍路程时间', '快速描述', '扶梯描述', '无障碍描述']
function text(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  if (typeof value === 'object' && 'richText' in value) return value.richText.map(t => t.text).join('').trim()
  throw new Error(`${cell.address} 含公式、链接或非文本值；请先粘贴为值，禁止执行或使用缓存公式结果`)
}
export async function readWorkbook(raw: Buffer, state: Catalog) {
  if (raw.length > 5 * 1024 * 1024) throw new Error('Excel 不得超过 5 MB')
  // Bound uncompressed ZIP entries before ExcelJS inflates potentially hostile uploads.
  let expanded = 0, entries = 0
  for (let i = Math.max(0, raw.length - 65557); i + 22 <= raw.length; i++) {
    if (raw.readUInt32LE(i) !== 0x06054b50) continue
    entries = raw.readUInt16LE(i + 10)
    let offset = raw.readUInt32LE(i + 16)
    if (entries > 300 || entries === 0) throw new Error('Excel 压缩结构无效或文件数量过多')
    for (let n = 0; n < entries; n++) {
      if (offset + 46 > raw.length || raw.readUInt32LE(offset) !== 0x02014b50) throw new Error('Excel ZIP 目录无效')
      expanded += raw.readUInt32LE(offset + 24)
      offset += 46 + raw.readUInt16LE(offset + 28) + raw.readUInt16LE(offset + 30) + raw.readUInt16LE(offset + 32)
    }
    break
  }
  if (!entries || expanded > 30 * 1024 * 1024) throw new Error('Excel 解压大小超过 30 MB 或格式无效')
  const workbook = new ExcelJS.Workbook()
  // The original template uses x: prefixed SpreadsheetML. ExcelJS expects
  // unprefixed elements; normalize only that namespace in an in-memory copy.
  const zip = await JSZip.loadAsync(raw)
  let normalized = false
  for (const entry of Object.values(zip.files)) if (!entry.dir && entry.name.startsWith('xl/') && entry.name.endsWith('.xml')) {
    const xml = await entry.async('string')
    const prefix = xml.match(/xmlns:([A-Za-z_][\w.-]*)="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/)
    if (!prefix) continue
    const p = prefix[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const content = xml.replace(new RegExp(`(<\\/?)${p}:`, 'g'), '$1').replace(prefix[0], 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
    zip.file(entry.name, content); normalized = true
  }
  for (const entry of Object.values(zip.files)) if (/^xl\/worksheets\/_rels\/.*\.rels$/.test(entry.name)) {
    const xml = await entry.async('string')
    const relative = xml.replace(/Target="\/xl\/tables\//g, 'Target="../tables/')
    if (relative !== xml) { zip.file(entry.name, relative); normalized = true }
  }
  await workbook.xlsx.load((normalized ? await zip.generateAsync({ type: 'nodebuffer' }) : raw) as any)
  const sheet = workbook.getWorksheet('车站维护')
  if (!sheet) throw new Error('缺少「车站维护」工作表')
  if (sheet.rowCount > 5000 || sheet.columnCount !== 28) throw new Error('主表须为原有 28 列，最多 4999 条数据')
  const actual = Array.from({ length: 28 }, (_, i) => text(sheet.getCell(1, i + 1)))
  if (new Set(actual).size !== 28 || headers.some(h => !actual.includes(h))) throw new Error('主表表头不匹配，请保留原有28列（允许调换列顺序）')
  const updates: Update[] = [], warnings: string[] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const values: Values = Object.fromEntries(actual.map((h, i) => [h, text(sheet.getCell(r, i + 1))]))
    if (!Object.values(values).some(Boolean)) continue
    // A narrowly identified legacy offset; never treat arbitrary descriptions as line names.
    if (values.车站 === '帝封江' && !values.换乘线路2 && state.dataset.lines.some(l => l.name === values['换乘描述1（无障碍）'])) {
      values.换乘线路2 = values['换乘描述1（无障碍）']; values['换乘描述1（无障碍）'] = ''
      warnings.push(`主表第 ${r} 行：帝封江第二换乘线路从「换乘描述1（无障碍）」移至「换乘线路2」；原文件已保留`)
    }
    try { updates.push({ entity: 'rows', key: resolveRow(state.dataset, values), values }) }
    catch (e) { throw new Error(`主表第 ${r} 行：${(e as Error).message}`) }
  }
  for (const [name, entity, cols] of [['设施明细', 'facilities', facilityHeaders], ['换乘明细', 'transfers', transferHeaders]] as const) {
    const extra = workbook.getWorksheet(name)
    if (!extra) continue
    if (extra.rowCount > 5000 || extra.columnCount !== cols.length || cols.some((h, i) => text(extra.getCell(1, i + 1)) !== h)) throw new Error(`${name} 列格式或行数无效`)
    for (let r = 2; r <= extra.rowCount; r++) {
      const values = Object.fromEntries(cols.map((h, i) => [h, text(extra.getCell(r, i + 1))]))
      if (!Object.values(values).some(Boolean)) continue
      const suffix = entity === 'facilities' ? values.编号 : values.目标方向ID
      updates.push({ entity, key: `${values.rowKey}/${suffix}`, values })
    }
  }
  const currentSync = workbook.getWorksheet('_榕乘同步')
  const legacySync = workbook.getWorksheet('_榕行同步')
  if (currentSync && legacySync && (text(currentSync.getCell('A1')) !== text(legacySync.getCell('A1')) || text(currentSync.getCell('B1')) !== text(legacySync.getCell('B1')))) throw new Error('工作簿存在不同的同步基线，请保留正确的同步页后再导入')
  const sync = currentSync ?? legacySync
  const exportId = sync ? text(sync.getCell('B1')) : undefined
  if (sync && text(sync.getCell('A1')) !== 'rongxing-export/1') throw new Error('未知同步信息版本')
  return { updates, warnings, exportId }
}
export async function writeWorkbook(state: Catalog, exportId: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = '榕乘'
  const main = workbook.addWorksheet('车站维护')
  main.addRow([...headers])
  for (const values of Object.values(state.rows)) main.addRow(headers.map(h => values[h] ?? ''))
  const facility = workbook.addWorksheet('设施明细'); facility.addRow(facilityHeaders)
  for (const values of Object.values(state.facilities)) facility.addRow(facilityHeaders.map(h => values[h] ?? ''))
  const transfer = workbook.addWorksheet('换乘明细'); transfer.addRow(transferHeaders)
  for (const values of Object.values(state.transfers)) transfer.addRow(transferHeaders.map(h => values[h] ?? ''))
  const guide = workbook.addWorksheet('填写说明')
  for (const row of [
    ['项目', '填写方式'], ['未知数据', '留空；空白不会删除本地数据。明确删除请填写【清空】，须单独审核。'],
    ['车门', '车厢:车门，多组用分号分隔，例如 2:1;2:2（格式示例，非实际数据）。'],
    ['距离和时间', '填写 米,分钟；未知留空。摘要不自动生成导航通路。'],
    ['方向', '主表按车站、线路、运行方向唯一定位；换乘明细按目标方向ID区分。'],
    ['设施明细', '额外设施、多组电梯及出入口备注填写此页；rowKey 从方向索引复制。'],
    ['同步基线', '保留 _榕乘同步 页（旧表的同步页也兼容）可进行三方比较；腾讯表格不保留时按无基线冲突审核。'],
    ['导航', '仅有摘要不能证明连续通路。管理员另行上传 station-entry/1 JSON，经整组审核更新导航。']
  ]) guide.addRow(row)
  const index = workbook.addWorksheet('方向索引'); index.addRow(['rowKey', '车站', '线路', '运行方向', '方向ID'])
  for (const [key, values] of Object.entries(state.rows)) index.addRow([key, values.车站, values.所属线路, values['运行方向（终点站）'], JSON.parse(key)[1]])
  const sync = workbook.addWorksheet('_榕乘同步'); sync.addRow(['rongxing-export/1', exportId]); sync.state = 'hidden'
  for (const sheet of [main, facility, transfer, guide, index]) {
    sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: sheet === main ? 3 : 0 }]
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } }
    sheet.getRow(1).height = 64
    sheet.columns.forEach((c, i) => { c.width = sheet === main ? i < 3 ? 18 : 24 : sheet === guide ? i ? 85 : 20 : 32 })
    sheet.eachRow((row, n) => {
      row.alignment = { vertical: 'middle', wrapText: true }
      if (n === 1) { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17664C' } } }
      else row.height = sheet === guide ? 45 : 32
    })
  }
  for (const index of [5, 8, 11, 14]) for (let r = 2; r <= main.rowCount; r++) main.getCell(r, index).dataValidation = { type: 'list', allowBlank: true, formulae: ['"是,否,未知"'], showErrorMessage: true, error: '请填写 是、否 或 未知' }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
