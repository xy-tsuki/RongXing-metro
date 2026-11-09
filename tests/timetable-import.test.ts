import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import raw from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { toCsv } from '../scripts/data-csv'
import { createCatalog } from '../src/maintenance/catalog'
import { MaintenanceStore } from '../scripts/maintenance/store'
import { prepareTimetable, serviceSeconds, importTimetable, openTimetableDatabase } from '../scripts/maintenance/timetable-import'
import { writeFileSync } from 'node:fs'

async function fixture(mutate?: (source: any) => void) {
  const source: any = { schema_version: '0.2', generated_date: '2026-10-17', source_caveats: { scope: '合成测试' }, lines: [{ line_id: 'L1', name: '1号线' }],
    stations: { L1: [{ station_id: 'a', name: '象峰', order: 1 }, { station_id: 'b', name: '秀山', order: 2 }] },
    trips: [{ trip_id: 'test', line_id: 'L1', direction_id: 'forward', origin: '象峰', destination: '秀山', source: 'synthetic', quality: 'synthetic_test', train_type: 'local', service_calendar: 'rest_day' }],
    stop_times: [{ trip_id: 'test', line_id: 'L1', direction_id: 'forward', stop_sequence: 1, station_id: 'a', station_name: '象峰', arrival_time: '23:59', departure_time: '', time_seconds: 86340, is_stop: true },
      { trip_id: 'test', line_id: 'L1', direction_id: 'forward', stop_sequence: 2, station_id: 'b', station_name: '秀山', arrival_time: '24:02', departure_time: '24:03', time_seconds: 86520, is_stop: true }] }
  mutate?.(source)
  const zip = new JSZip()
  zip.file('rongxing_timetable_import.json', JSON.stringify(source))
  zip.file('trips.csv', toCsv(source.trips))
  zip.file('stations.csv', toCsv(source.stations.L1.map((s: any) => ({ line_id: 'L1', ...s }))))
  zip.file('stop_times.csv', toCsv(source.stop_times.map((s: any) => ({ ...s, is_stop: s.is_stop ? 'True' : 'False' }))))
  zip.file('QA_summary.json', JSON.stringify({ total_trips: source.trips.length, total_stop_times: source.stop_times.length }))
  return zip.generateAsync({ type: 'nodebuffer' })
}
function addPassEvent(source: any) {
  source.stations.L1.push({ station_id: 'c', name: '罗汉山', order: 3 })
  source.trips[0].destination = '罗汉山'
  source.stop_times[1].is_stop = false
  source.stop_times[1].departure_time = ''
  source.stop_times.push({ ...source.stop_times[0], stop_sequence: 3, station_id: 'c', station_name: '罗汉山', arrival_time: '24:06', departure_time: '24:07', time_seconds: 86760 })
}
describe('时刻表测试版导入', () => {
  it('保留跨午夜服务秒数，拒绝越界或含糊时刻', () => {
    expect(serviceSeconds('24:18')).toBe(87480)
    expect(serviceSeconds('07:30:30')).toBe(27030)
    expect(() => serviceSeconds('24:60')).toThrow()
    expect(() => serviceSeconds('7:3')).toThrow()
  })
  it('显式发车优先，其他源时刻作为测试发车，保留原始字段', async () => {
    const result = await prepareTimetable(await fixture(), raw as MetroDataset)
    expect(result.report.arrivalAsDeparture).toBe(1)
    expect(result.report.explicitDepartures).toBe(1)
    expect(result.bundle.trips[0].stops.map(s => s[1])).toEqual([86340, 86580])
    expect(result.source.stop_times[0].departure_time).toBe('')
    expect(result.bundle.trips[0].serviceId).toBe('fz-l1-forward')
  })
  it('可导入显式工作日日历，不改写成休息日或每日班次', async () => {
    const result = await prepareTimetable(await fixture(s => { s.trips[0].service_calendar = 'workday' }), raw as MetroDataset)
    expect(result.bundle.trips[0].calendar).toBe('workday')
    expect(result.source.trips[0].service_calendar).toBe('workday')
    expect(result.report.calendarPolicy).toContain('调休补班')
    await expect(prepareTimetable(await fixture(s => { s.trips[0].service_calendar = 'guess' }), raw as MetroDataset)).rejects.toThrow('日历')
  })
  it('拒绝重复班次、引用错误、停站倒序和CSV不一致', async () => {
    await expect(prepareTimetable(await fixture(s => s.trips.push(s.trips[0])), raw as MetroDataset)).rejects.toThrow('重复')
    await expect(prepareTimetable(await fixture(s => s.stop_times[0].station_id = 'unknown'), raw as MetroDataset)).rejects.toThrow('引用')
    await expect(prepareTimetable(await fixture(s => s.stop_times[1].stop_sequence = 1), raw as MetroDataset)).rejects.toThrow('不连续')
    const zip = await JSZip.loadAsync(await fixture()); zip.file('trips.csv', 'trip_id\nother\n')
    await expect(prepareTimetable(await zip.generateAsync({ type: 'nodebuffer' }), raw as MetroDataset)).rejects.toThrow('不一致')
  })
  it('通过事件保留原始证据但不能成为上下车站；到站不能早于前站发车', async () => {
    const result = await prepareTimetable(await fixture(addPassEvent), raw as MetroDataset)
    expect(result.report.passThroughEvents).toBe(1)
    expect(result.report.boardingStopTimes).toBe(2)
    expect(result.source.stop_times).toHaveLength(3)
    expect(result.bundle.trips[0].stops).toEqual([['fz-象峰', 86340], ['fz-罗汉山', 86820]])
    await expect(prepareTimetable(await fixture(s => { addPassEvent(s); s.stop_times[0].departure_time = '24:03' }), raw as MetroDataset)).rejects.toThrow('时序倒退')
  })
  it.skipIf(Number(process.versions.node.split('.')[0]) < 22)('预览不改库；整库备份、事务导入、原件和重复去重均可核对', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rongxing-timetable-')), path = join(directory, 'db.sqlite'), archive = join(directory, 'source.zip')
    try {
      const store = new MaintenanceStore(path, createCatalog(raw as MetroDataset)); const before = store.read(); store.close()
      writeFileSync(archive, await fixture(addPassEvent))
      const preview = await importTimetable(path, archive, join(directory, 'preview'), false)
      expect(preview.report.mode).toBe('preview')
      let db = openTimetableDatabase(path)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='timetable_imports'").get()).toBeUndefined(); db.close()
      const result = await importTimetable(path, archive, join(directory, 'apply'), true)
      db = openTimetableDatabase(path)
      expect(JSON.parse(db.prepare('SELECT json FROM state').get().json)).toEqual(before)
      expect(db.prepare('SELECT COUNT(*) AS n FROM timetable_stop_times').get().n).toBe(3)
      expect(db.prepare('SELECT basis FROM timetable_stop_times WHERE sequence=2').get().basis).toBe('source_pass_through_not_boardable')
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(Buffer.from(db.prepare('SELECT raw FROM sources').get().raw)).toEqual(readFileSync(archive))
      const row = db.prepare('SELECT json,basis FROM timetable_stop_times WHERE sequence=1').get()
      expect(JSON.parse(row.json).departure_time).toBe(''); expect(row.basis).toBe('user_test_arrival_as_departure'); db.close()
      const backup = new MaintenanceStore(result.report.backup, createCatalog(raw as MetroDataset)); expect(backup.read()).toEqual(before); backup.close()
      const again = await importTimetable(path, archive, join(directory, 'again'), true)
      expect(again.report.existingImportId).toBe(result.report.importId)
      expect(again.bundle).toEqual(result.bundle)
      db = openTimetableDatabase(path); expect(db.prepare('SELECT COUNT(*) AS n FROM timetable_imports').get().n).toBe(1); db.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
