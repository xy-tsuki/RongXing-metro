import { beforeEach, afterEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import raw from '../src/data/fuzhou-network.json'
import { createCatalog, compareUpdates, rowKey, validateUpdate } from '../src/maintenance/catalog'
import type { Catalog, Update } from '../src/maintenance/catalog'
import { MaintenanceStore } from '../scripts/maintenance/store'
import { MaintenanceService } from '../scripts/maintenance/service'
import { createMaintenanceServer } from '../scripts/maintenance/server'
import { readWorkbook, writeWorkbook } from '../scripts/maintenance/workbook'
import { validateDataset } from '../src/core/validation'
import type { MetroDataset } from '../src/core/types'
import { planJourney } from '../src/core'

const initial = () => createCatalog(raw as MetroDataset)
const source = '测试：合成采集记录，不是现场数据', date = '2026-10-16'
function quick(state: Catalog, value = '2:1;2:2'): Update {
  return { entity: 'rows', key: Object.keys(state.rows)[0], values: { 楼梯1对应车厢车门: value } }
}
describe('采集契约与Excel兼容', () => {
  test('基础目录保持232条方向记录，三线换乘有两组目标，不生成设施', () => {
    const c = initial()
    expect(Object.keys(c.rows)).toHaveLength(232)
    expect(Object.values(c.rows).filter(v => v.车站 === '帝封江')).toHaveLength(6)
    expect(Object.values(c.rows).filter(v => v.车站 === '帝封江').every(v => v.换乘线路1 && v.换乘线路2)).toBe(true)
    expect(c.dataset.walkEdges).toHaveLength(0)
  })
  test('同名不同站ID不合并；反方向分别存储', () => {
    const c = initial(), keys = Object.keys(c.rows).filter(k => c.rows[k].车站.startsWith('三叉街'))
    expect(new Set(keys.map(k => JSON.parse(k)[0])).size).toBe(2)
    expect(keys).toHaveLength(4)
  })
  test('空白不删除、明确清空为冲突，重复行与无效车厢被拒绝', () => {
    const c = initial(), u = quick(c)
    c.rows[u.key].楼梯1对应车厢车门 = '1:1'
    expect(compareUpdates(c, [{ ...u, values: { 楼梯1对应车厢车门: '' } }])).toHaveLength(0)
    expect(compareUpdates(c, [{ ...u, values: { 楼梯1对应车厢车门: '【清空】' } }])[0].kind).toBe('conflict')
    expect(() => compareUpdates(c, [u, u])).toThrow('重复')
    expect(validateUpdate(c, quick(c, '7:1')).join()).toContain('车厢')
    expect(validateUpdate(c, quick(c, '2:1;2:1')).join()).toContain('重复')
  })
  test('三方比较保留本地修改、识别双方修改与实际无变化', () => {
    const c = initial(), u = quick(c), base = initial()
    base.rows[u.key].楼梯1对应车厢车门 = '1:1'; c.rows[u.key].楼梯1对应车厢车门 = '3:1'
    expect(compareUpdates(c, [{ ...u, values: { 楼梯1对应车厢车门: '1:1' } }], base)).toHaveLength(0)
    expect(compareUpdates(c, [u], base)[0].kind).toBe('conflict')
    c.rows[u.key].楼梯1对应车厢车门 = '1:1'
    expect(compareUpdates(c, [u], base)[0].kind).toBe('modified')
  })
  test('实际旧工作簿6个错位被明确识别，主表28列往返', async () => {
    const c = initial(), parsed = await readWorkbook(readFileSync('data-entry/fuzhou-station-maintenance.xlsx'), c)
    expect(parsed.updates).toHaveLength(232)
    // This test remains valid after correcting the distributed template.
    expect([0, 6]).toContain(parsed.warnings.length)
    expect(() => compareUpdates(c, parsed.updates)).not.toThrow()
    const out = await writeWorkbook(c, 'test-export')
    const back = await readWorkbook(out, c)
    expect(back.exportId).toBe('test-export'); expect(compareUpdates(c, back.updates)).toHaveLength(0)
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out as any)
    expect(wb.getWorksheet('车站维护')!.columnCount).toBe(28)
    expect(wb.getWorksheet('车站维护')!.getRow(1).values).toHaveLength(29)
  })
  test('多组设施、多门位和目标方向明细可以往返，外线路方向引用拒绝', async () => {
    const c = initial(), key = Object.keys(c.rows).find(k => c.rows[k].车站 === '帝封江')!
    for (let i = 1; i <= 5; i++) c.facilities[`${key}/lift-${i}`] = { rowKey: key, 编号: `lift-${i}`, 类型: '电梯', 车门: '2:1;2:2' }
    const [stationId, serviceId] = JSON.parse(key)
    const service = c.dataset.services.find(s => s.id === serviceId)!
    const targets = c.dataset.services.filter(s => s.lineId !== service.lineId && s.stops.some(p => p.stationId === stationId))
    for (const t of targets) c.transfers[`${key}/${t.id}`] = { rowKey: key, 目标方向ID: t.id, 快速路程时间: '120,3', 快速描述: '合成测试描述' }
    const parsed = await readWorkbook(await writeWorkbook(c, 'test'), c)
    expect(parsed.updates.filter(u => u.entity === 'facilities')).toHaveLength(5)
    expect(parsed.updates.filter(u => u.entity === 'transfers')).toHaveLength(4)
    expect(() => compareUpdates(c, parsed.updates)).not.toThrow()
    const bad = { entity: 'transfers' as const, key: `${key}/${serviceId}`, values: { rowKey: key, 目标方向ID: serviceId } }
    expect(validateUpdate(c, bad).join()).toContain('其他线路')
  })
  test('附件式前三列重排和6处帝封江旧错位不会改变记录身份', async () => {
    const c = initial(), wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await writeWorkbook(c, 'test') as any)
    const sheet = wb.getWorksheet('车站维护')!
    sheet.eachRow(row => {
      const [station, line, direction] = [row.getCell(1).value, row.getCell(2).value, row.getCell(3).value]
      if (station === '帝封江') { row.getCell(21).value = row.getCell(22).value; row.getCell(22).value = '' }
      row.getCell(1).value = line; row.getCell(2).value = direction; row.getCell(3).value = station
    })
    const parsed = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), c)
    expect(parsed.warnings).toHaveLength(6)
    expect(compareUpdates(c, parsed.updates)).toEqual([])
  })
  test('公式、重复记录、未知表头、错误压缩文件均不能进入审核', async () => {
    const c = initial(), buf = await writeWorkbook(c, 'test'), wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf as any); wb.getWorksheet('车站维护')!.getCell('D2').value = { formula: '1+1', result: 2 }
    await expect(readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), c)).rejects.toThrow('公式')
    await expect(readWorkbook(Buffer.from('invalid'), c)).rejects.toThrow('格式')
    wb.getWorksheet('车站维护')!.getCell('D2').value = ''
    const cells = wb.getWorksheet('车站维护')!.getRow(2).values as ExcelJS.CellValue[]
    wb.getWorksheet('车站维护')!.addRow(cells)
    const duplicate = await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), c)
    expect(() => compareUpdates(c, duplicate.updates)).toThrow('重复')
    wb.getWorksheet('车站维护')!.getCell('A1').value = '无效表头'
    await expect(readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), c)).rejects.toThrow('表头')
  })
})

describe.skipIf(Number(process.versions.node.split('.')[0]) < 22)('SQLite审核及HTTP完整闭环（Node22+）', () => {
  let dir: string, store: MaintenanceStore, service: MaintenanceService
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rongxing-maintenance-test-')); store = new MaintenanceStore(join(dir, 'test.sqlite'), initial()); service = new MaintenanceService(store) })
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  const stage = (s: MaintenanceService, value = '2:1') => s.stage([quick(s.store.read(), value)], source, date, Buffer.from(value))
  const approve = (b: ReturnType<typeof stage>) => ({ revision: b.revision, accept: b.changes.filter(c => !c.decision).map(c => c.id), reject: [], actor: '测试审核员', note: '仅测试合成数据', resolveConflicts: true })
  test('待审核不影响正式数据；合并、原始文件、备份、历史和回滚可恢复', () => {
    const before = store.read(), batch = stage(service)
    expect(store.read()).toEqual(before)
    expect(store.source(batch.hash).toString()).toBe('2:1')
    const result = service.review(batch.id, approve(batch))
    expect(store.read().rows[batch.changes[0].key].楼梯1对应车厢车门).toBe('2:1')
    expect(store.history()).toHaveLength(1)
    const backup = new MaintenanceStore(result.backup.path, initial()); expect(backup.read()).toEqual(before); backup.close()
    store.restore(result.historyId, result.revision, '测试审核员', '测试回滚')
    expect(store.read().rows).toEqual(before.rows); expect(store.read().revision).toBe(2); expect(store.history()).toHaveLength(2)
  })
  test('重启不重建数据；重复审核、过期审核、并发写入全部拦截', () => {
    const a = stage(service), b = stage(service, '3:1')
    service.review(a.id, approve(a))
    expect(() => service.review(a.id, approve(a))).toThrow('变化')
    expect(() => service.review(b.id, approve(b))).toThrow('变化')
    const next = service.refresh(b.id)
    expect(store.batch(b.id).status).toBe('superseded')
    expect(next.changes[0].kind).toBe('conflict')
    expect(() => service.review(next.id, { ...approve(next), resolveConflicts: false })).toThrow('冲突')
    service.review(next.id, approve(next))
    const saved = store.read(); store.close(); store = new MaintenanceStore(join(dir, 'test.sqlite'), initial())
    expect(store.read()).toEqual(saved)
  })
  test('刷新三方差异仍保留导出基线，不把云端未改字段覆盖本地', () => {
    const base = initial(), update = quick(base, '1:1')
    base.rows[update.key].楼梯1对应车厢车门 = '1:1'
    const first = stage(service, '3:1'); service.review(first.id, approve(first))
    const batch = service.stage([{ ...update, values: { 楼梯1对应车厢车门: '1:1', '1是否有上行扶梯': '是' } }], source, date, Buffer.from('baseline'), base)
    expect(batch.changes.map(c => c.field)).toEqual(['1是否有上行扶梯'])
    const refreshed = service.refresh(batch.id)
    expect(refreshed.changes.map(c => c.field)).toEqual(['1是否有上行扶梯'])
    service.review(refreshed.id, approve(refreshed))
    expect(store.read().rows[update.key].楼梯1对应车厢车门).toBe('3:1')
  })
  test('部分审核保留剩余字段；拒绝不写入采集值', () => {
    const update = quick(store.read()); update.values['1是否有上行扶梯'] = '是'
    const b = service.stage([update], source, date, Buffer.from('partial'))
    service.review(b.id, { ...approve(b), accept: [b.changes[0].id] })
    const pending = store.batch(b.id); expect(pending.status).toBe('pending')
    service.review(b.id, { ...approve(pending), accept: [], reject: [b.changes[1].id] })
    expect(store.read().rows[update.key]['1是否有上行扶梯']).toBeUndefined()
    expect(store.batch(b.id).status).toBe('reviewed')
  })
  test('真实附件导入与导出重导无损，空白不会覆盖本地资料', async () => {
    const b = await service.importWorkbook(readFileSync('data-entry/fuzhou-station-maintenance.xlsx'), source, date)
    expect(b.changes).toHaveLength(0)
    const changes = stage(service); service.review(changes.id, approve(changes))
    const noChanges = await service.importWorkbook(await service.exportWorkbook(), source, date)
    expect(noChanges.changes).toHaveLength(0)
    expect(validateDataset(store.read().dataset)).toEqual([])
  })
  test('拓扑成组审核复用现有校验；摘要审核不改变导航', () => {
    const before = store.read().dataset
    const b = stage(service); service.review(b.id, approve(b))
    expect(store.read().dataset).toEqual(before)
    const station = before.stations[0]
    const patch = { format: 'station-entry/1' as const, station: station.name, provenance: { kind: 'survey' as const, source, recordedAt: date }, nodes: [{ label: '合成校验站厅', level: -1, kind: 'concourse' as const, knowledge: 'unknown' as const }], paths: [], manualRecommendations: [] }
    const nav = service.patch(patch, Buffer.from(JSON.stringify(patch)))
    expect(nav.changes[0].details?.length).toBeGreaterThan(0)
    expect(store.read().dataset.walkNodes).toHaveLength(0)
    service.review(nav.id, approve(nav))
    expect(store.read().dataset.walkNodes).toHaveLength(1)
    expect(validateDataset(store.read().dataset)).toEqual([])
    expect(() => service.patch({ ...patch, provenance: { ...patch.provenance, kind: 'demo' } }, Buffer.from(''))).toThrow('合成')
  })
  test('HTTP投稿→待审核→鉴权合并→导出；非授权来源拒绝，基础导航保持正常', async () => {
    const token = 'integration-test-token-1234567890', server = createMaintenanceServer(service, token, ['http://127.0.0.1:5173'])
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    const address = server.address() as { port: number }, base = `http://127.0.0.1:${address.port}`
    try {
      expect((await fetch(`${base}/api/admin/batches`)).status).toBe(401)
      expect((await fetch(`${base}/api/catalog`, { headers: { Origin: 'https://untrusted.invalid' } })).status).toBe(403)
      expect((await fetch(`${base}/api/admin/batches`, { headers: { Authorization: `Bearer ${'x'.repeat(token.length)}` } })).status).toBe(401)
      const rowKey = Object.keys(store.read().rows)[0]
      for (const values of [{ rowKey, 编号: 'A1', 类型: '扶梯' }, { rowKey, 编号: 'A1', 类型: '电梯', 上行扶梯: '未知' }]) {
        const invalid = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: [{ entity: 'facilities', key: `${rowKey}/A1`, values }], source, recordedAt: date }) })
        expect(invalid.status).toBe(400)
      }
      expect(store.batches()).toHaveLength(0)
      const res = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: [quick(store.read())], source, recordedAt: date }) })
      expect(res.status).toBe(201); const pending = await res.json() as { id: string }
      const retry = await fetch(`${base}/api/submissions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: [quick(store.read())], source, recordedAt: date }) })
      expect((await retry.json() as { id: string }).id).toBe(pending.id)
      expect(store.batches()).toHaveLength(1)
      const b = store.batch(pending.id)
      const reviewed = await fetch(`${base}/api/admin/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ id: b.id, ...approve(b) }) })
      expect(reviewed.status).toBe(200)
      const excel = await fetch(`${base}/api/admin/export.xlsx`, { headers: { Authorization: `Bearer ${token}` } })
      const parsed = await readWorkbook(Buffer.from(await excel.arrayBuffer()), store.read()); expect(parsed.updates).toHaveLength(232)
      const official = await (await fetch(`${base}/api/dataset`)).json() as MetroDataset
      const result = planJourney(official, { from: official.stations[0].id, to: official.stations[1].id, mode: 'shortest' })
      expect(result.routes.length).toBeGreaterThan(0)
    } finally { await new Promise<void>(r => server.close(() => r())) }
  })
})
