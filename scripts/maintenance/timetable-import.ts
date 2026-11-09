import JSZip from 'jszip'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, constants } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseCsv } from '../data-csv'
import type { MetroDataset } from '../../src/core/types'
import { validateDataset } from '../../src/core/validation'
import { backupLocationFromEnv, rollingBackup } from './backup'
import type { TestTimetable, TestTrip } from '../../src/maintenance/timetable-types'
import { readResearchTimetable } from './research-timetable'
import { readFourLineResearch } from './research-four-lines'
import { readSixLineResearch } from './research-six-lines'
import { readWorkdayCsv } from './research-workday-csv'
import { readWorkdayResearch } from './research-workday'

type RecordValue = Record<string, any>
interface Database { prepare(sql: string): { get(...args: any[]): any; all(...args: any[]): any[]; run(...args: any[]): unknown }; exec(sql: string): void; close(): void }
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
export function serviceSeconds(value: unknown): number {
  ensure(typeof value === 'string' && /^\d{2}:\d{2}(?::\d{2})?$/.test(value), `时刻格式无效：${String(value)}`)
  const [hours, minutes, seconds = 0] = value.split(':').map(Number)
  ensure(hours < 48 && minutes < 60 && seconds < 60, `时刻越界：${value}`)
  return hours * 3600 + minutes * 60 + seconds
}
export async function prepareTimetable(raw: Buffer, dataset: MetroDataset, baseSource?: RecordValue) {
  ensure(raw.length <= 40 * 1024 * 1024, '导入包超过40MB')
  const standaloneCsv = raw.subarray(0,100).toString('utf8').replace(/^\uFEFF/,'').match(/^(?:"trip_id"|trip_id),(?:"line_id"|line_id),(?:"calendar"|calendar),/) !== null
  const zip = standaloneCsv ? new JSZip() : await JSZip.loadAsync(raw, { checkCRC32: true })
  const entries = Object.values(zip.files)
  ensure(entries.length <= 300 && entries.every(e => !e.name.includes('..') && !e.name.startsWith('/') && !e.name.includes('\\')), '压缩包目录无效')
  // Check central-directory declared expanded size before reading the source JSON.
  let expanded = 0
  for (let p = 0; p + 46 < raw.length; p++) if (raw.readUInt32LE(p) === 0x02014b50) expanded += raw.readUInt32LE(p + 24)
  ensure(expanded <= 100 * 1024 * 1024, '压缩包解压大小超过100MB')
  const read = async (name: string) => {
    const entry = zip.file(name); ensure(entry, `缺少 ${name}`)
    return (await entry.async('string')).replace(/^\uFEFF/, '')
  }
  const workdayManifests = entries.filter(e => e.name.endsWith('/output/工作日_六条已运营线路_全网候选.csv'))
  ensure(workdayManifests.length <= 1, '工作日候选格式不唯一')
  const workdayRoot = workdayManifests[0]?.name.replace('output/工作日_六条已运营线路_全网候选.csv', '')
  ensure(workdayRoot !== undefined || raw.length <= 30 * 1024 * 1024, '导入包超过30MB')
  const fourManifests = entries.filter(e => e.name.endsWith('/output/parameters_and_QA.json'))
  ensure(fourManifests.length <= 1, '研究包存在多个四线版本')
  const fourRoot = fourManifests[0]?.name.replace('output/parameters_and_QA.json','')
  const sixManifests = entries.filter(e => e.name.endsWith('/output/休息日六运营线路_统一逐站候选.csv'))
  ensure(sixManifests.length <= 1, '研究包存在多个六线版本')
  const sixRoot = sixManifests[0]?.name.replace('output/休息日六运营线路_统一逐站候选.csv', '')
  ensure(!(sixRoot !== undefined && (fourRoot !== undefined || zip.file('results/manifest_v1.2.json'))), '研究包同时含多种候选格式，须先明确选择')
  ensure(workdayRoot === undefined || (sixRoot === undefined && fourRoot === undefined && !zip.file('results/manifest_v1.2.json')), '研究包同时含多种候选格式')
  if (sixRoot !== undefined) ensure(!baseSource?.trips.some((trip: RecordValue) => trip.service_calendar === 'workday'), '六线休息日整包不能删除已有工作日版本，请先制定合并范围')
  const research = standaloneCsv || workdayRoot !== undefined || !!zip.file('results/manifest_v1.2.json') || fourRoot !== undefined || sixRoot !== undefined
  const source: RecordValue = standaloneCsv ? readWorkdayCsv(raw, baseSource) : workdayRoot !== undefined ? await readWorkdayResearch(zip, baseSource, workdayRoot) : sixRoot !== undefined ? await readSixLineResearch(zip, dataset, sixRoot) : fourRoot !== undefined ? await readFourLineResearch(zip,baseSource!,fourRoot) : research ? await readResearchTimetable(zip, baseSource!) : JSON.parse(await read('rongxing_timetable_import.json'))
  ensure(source.schema_version === '0.2' && Array.isArray(source.lines) && Array.isArray(source.trips) && Array.isArray(source.stop_times) && source.stations && typeof source.source_caveats === 'object', '不支持的时刻表结构')
  ensure(source.trips.length <= 20000 && source.stop_times.length <= 500000, '记录数量超限')
  ensure(validateDataset(dataset).length === 0, '现有导航包校验失败')
  const stations = new Map<string, { id: string; lineId: string; name: string; order: number }>()
  const lines = new Map<string, string>()
  for (const line of source.lines) {
    ensure(!lines.has(line.line_id), '线路ID重复')
    const matches = dataset.lines.filter(l => l.name === line.name || line.line_id === 'BEX' && l.name === '滨海快线（F1线）')
    ensure(matches.length === 1, `线路无法匹配：${line.line_id}`)
    lines.set(line.line_id, matches[0].id)
    const sourceStations = source.stations[line.line_id]
    ensure(Array.isArray(sourceStations) && sourceStations.length > 1, '缺少线路车站')
    const lineStationIds = new Set(dataset.services.filter(s => s.lineId === matches[0].id).flatMap(s => s.stops.map(p => p.stationId)))
    for (const [index, station] of sourceStations.entries()) {
      const candidates = dataset.stations.filter(s => lineStationIds.has(s.id) && (s.name === station.name || line.line_id === 'BEX' && station.name === '三叉街' && s.name === '三叉街（滨海快线）'))
      ensure(candidates.length === 1 && !stations.has(station.station_id) && station.order === index + 1, `车站引用/站序无效：${station.station_id}`)
      stations.set(station.station_id, { id: candidates[0].id, lineId: matches[0].id, name: candidates[0].name, order: station.order })
    }
    ensure(new Set(sourceStations.map((s: RecordValue) => stations.get(s.station_id)!.id)).size === sourceStations.length, '线路内站点重复')
  }
  const tripSources = new Map<string, RecordValue>(), stops = new Map<string, RecordValue[]>()
  for (const trip of source.trips) {
    ensure(typeof trip.trip_id === 'string' && !tripSources.has(trip.trip_id) && lines.has(trip.line_id), '班次ID重复或线路引用无效')
    ensure(['rest_day', 'workday', 'all_days'].includes(trip.service_calendar) && typeof trip.source === 'string' && typeof trip.quality === 'string', `班次日历或来源无效：${trip.trip_id}`)
    tripSources.set(trip.trip_id, trip); stops.set(trip.trip_id, [])
  }
  for (const stop of source.stop_times) {
    const trip = tripSources.get(stop.trip_id), station = stations.get(stop.station_id)
    ensure(trip && station && station.lineId === lines.get(trip.line_id) && stop.line_id === trip.line_id && stop.direction_id === trip.direction_id, `停站引用无效：${stop.trip_id}/${stop.station_id}`)
    ensure(typeof stop.is_stop === 'boolean' && Number.isInteger(stop.stop_sequence) && stop.stop_sequence > 0 && stop.time_seconds === serviceSeconds(stop.arrival_time || stop.departure_time), '停站序号或源时刻秒数不一致')
    if (stop.departure_time && stop.arrival_time) ensure(serviceSeconds(stop.departure_time) >= stop.time_seconds, '发车早于到站')
    stops.get(stop.trip_id)!.push(stop)
  }
  const trips: TestTrip[] = []
  let overridden = 0, explicitDepartures = 0, overnight = 0
  const serviceByDirection = new Map<string, string>()
  for (const trip of source.trips) {
    const rows = stops.get(trip.trip_id)!.sort((a, b) => a.stop_sequence - b.stop_sequence)
    ensure(rows.length > 1 && rows.every((s, i) => s.stop_sequence === i + 1), `班次停站序号不连续：${trip.trip_id}`)
    ensure(rows[0].station_name === trip.origin && rows[rows.length - 1].station_name === trip.destination, `班次起终点不一致：${trip.trip_id}`)
    const stationIds = rows.map(s => stations.get(s.station_id)!.id)
    const candidates = dataset.services.filter(s => s.lineId === lines.get(trip.line_id) && stationIds.every((id, i) => {
      const at = s.stops.findIndex(p => p.stationId === id)
      return at >= 0 && (i === 0 || at > s.stops.findIndex(p => p.stationId === stationIds[i - 1]))
    }))
    ensure(candidates.length === 1, `班次运行方向不能唯一匹配：${trip.trip_id}`)
    const directionKey = `${trip.line_id}:${trip.direction_id}`, serviceId = candidates[0].id
    ensure(!serviceByDirection.has(directionKey) || serviceByDirection.get(directionKey) === serviceId, '相同方向ID归属冲突')
    serviceByDirection.set(directionKey, serviceId)
    const eventPairs: [string, number][] = rows.map(s => {
      const time = s.departure_time ? serviceSeconds(s.departure_time) : s.time_seconds
      if (s.departure_time) explicitDepartures++; else overridden++
      if (time >= 86400) overnight++
      return [stations.get(s.station_id)!.id, time]
    })
    ensure(new Set(stationIds).size === stationIds.length && eventPairs.every((p, i) => i === 0 || serviceSeconds(rows[i].arrival_time || rows[i].departure_time) >= eventPairs[i - 1][1]), `班次时序倒退或站点重复：${trip.trip_id}`)
    ensure(rows[0].is_stop && rows[rows.length - 1].is_stop, `班次起终点必须允许上下车：${trip.trip_id}`)
    const pairs = eventPairs.filter((_, i) => rows[i].is_stop)
    trips.push({ id: trip.trip_id, lineId: lines.get(trip.line_id)!, serviceId, type: trip.train_type, calendar: trip.service_calendar, quality: trip.quality, stops: pairs })
  }
  // Cross-check every CSV record against the JSON rather than trusting the package's QA claims.
  const csvSources: Record<string, RecordValue[]> = { 'trips.csv': source.trips, 'stop_times.csv': source.stop_times,
    'stations.csv': Object.entries(source.stations).flatMap(([line_id, values]) => (values as RecordValue[]).map(s => ({ line_id, ...s }))) }
  for (const [name, expected] of research ? [] : Object.entries(csvSources)) {
    const actual = parseCsv(await read(name)); ensure(actual.length === expected.length, `${name} 数量与JSON不一致`)
    for (let i = 0; i < actual.length; i++) for (const [key, value] of Object.entries(actual[i])) {
      const original = expected[i][key], text = typeof original === 'boolean' ? original ? 'True' : 'False' : String(original ?? '')
      ensure(String(value) === text, `${name} 第${i + 2}行 ${key} 与JSON不一致`)
    }
  }
  const qa = research ? { total_trips: source.trips.length, total_stop_times: source.stop_times.length } : JSON.parse(await read('QA_summary.json'))
  ensure((qa.total_trips ?? qa.total_trips_all_lines) === trips.length && (qa.total_stop_times ?? qa.total_stop_times_all_lines) === source.stop_times.length, 'QA汇总数量不一致')
  const version = `test-${source.generated_date}-${sha(raw).slice(0, 12)}`
  const bundle: TestTimetable = { format: 'rongxing-test-timetable/1', version, timezone: 'Asia/Shanghai', policy: 'all-source-times-as-test-departures',
    notice: '测试初版：全部源时刻按发车使用，含截图平移推算、补推班次及F1普通车模型；非官方精确时刻。换乘仅作时间衔接试算，现场通行未核实。', stations: [...stations.values()], trips }
  const report = { version, status: 'test_enabled', sourceFileName: standaloneCsv ? 'source.csv' : 'source.zip', importFormat: standaloneCsv ? 'research-workday-csv-v2.0' : workdayRoot !== undefined ? 'research-workday-six-v1.0' : sixRoot !== undefined ? 'research-rest-six-v3.1' : fourRoot !== undefined ? 'research-L1245-H1' : research ? 'research-results-v1.2-full-BEX' : 'canonical-0.2', policy: bundle.policy, lines: lines.size, lineStations: stations.size, directions: serviceByDirection.size,
    trips: trips.length, stopTimes: source.stop_times.length, boardingStopTimes: trips.reduce((n, t) => n + t.stops.length, 0), passThroughEvents: source.stop_times.filter((s: RecordValue) => !s.is_stop).length, explicitDepartures, arrivalAsDeparture: overridden, overnight,
    byLine: Object.fromEntries([...lines].map(([id, canonical]) => [id, { lineId: canonical, trips: trips.filter(t => t.lineId === canonical).length }])),
    quality: source.trips.reduce((out: Record<string, number>, t: RecordValue) => ({ ...out, [t.quality]: (out[t.quality] ?? 0) + 1 }), {}),
    sourceCaveats: source.source_caveats, calendarPolicy: 'rest_day按内置国务院放假调休日历匹配休息日，workday匹配普通工作日及调休补班，all_days每日；未收录年份不匹配日期限定班次', warnings: [bundle.notice] }
  return { source, bundle, report, stations, stops }
}
export function openTimetableDatabase(path: string): Database {
  ensure(existsSync(path), '维护数据库不存在；请先运行 maintenance:serve，不自动重建数据库')
  const require = createRequire(import.meta.url)
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => Database }
  const db = new DatabaseSync(path)
  ensure(db.prepare('SELECT version FROM rongxing_meta').get()?.version === 1, '不兼容的维护数据库')
  db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;')
  return db
}
export async function importTimetable(path: string, archive: string, output: string, apply: boolean) {
  const db = openTimetableDatabase(path)
  try {
    const before = db.prepare('SELECT json FROM state WHERE id=1').get().json as string
    const raw = readFileSync(archive), hash = sha(raw)
    const dataset = JSON.parse(before).dataset as MetroDataset
    const hasTimetable = db.prepare("SELECT name FROM sqlite_master WHERE name='timetable_imports'").get()
    let baseSource: RecordValue | undefined
    let previousBundle: TestTimetable | undefined
    if (hasTimetable) {
      const previous = db.prepare('SELECT id,report_json,bundle_json FROM timetable_imports ORDER BY rowid DESC LIMIT 1').get()
      if (previous) {
        previousBundle = JSON.parse(previous.bundle_json)
        const previousReport = JSON.parse(previous.report_json)
        const byLine = previousReport.byLine as Record<string, {lineId: string}>
        const stations: Record<string, RecordValue[]> = {}
        for (const row of db.prepare('SELECT * FROM timetable_stations WHERE import_id=?').all(previous.id)) {
          const sourceLine = Object.keys(byLine).find(id => byLine[id].lineId === row.line_id)!
          const station = JSON.parse(row.json)
          ;(stations[sourceLine] ??= []).push({ station_id: row.source_id, name: station.name === '三叉街（滨海快线）' ? '三叉街' : station.name, order: station.order })
        }
        for (const values of Object.values(stations)) values.sort((a, b) => a.order - b.order)
        baseSource = { schema_version: '0.2', lines: Object.entries(byLine).map(([line_id, value]) => ({line_id, name: dataset.lines.find(l => l.id === value.lineId)!.name})), stations,
          trips: db.prepare('SELECT json FROM timetable_trips WHERE import_id=? ORDER BY rowid').all(previous.id).map(r => JSON.parse(r.json)),
          stop_times: db.prepare('SELECT json FROM timetable_stop_times WHERE import_id=? ORDER BY rowid').all(previous.id).map(r => JSON.parse(r.json)), source_caveats: previousReport.sourceCaveats }
      }
    }
    const prepared = await prepareTimetable(raw, dataset, baseSource)
    const report: RecordValue = { ...prepared.report, sourceHash: hash, database: path, mode: apply ? 'apply' : 'preview' }
    if (previousBundle) {
      report.previousVersion = previousBundle.version
      report.lineDifferences = [...new Set([...previousBundle.trips, ...prepared.bundle.trips].map(t => t.lineId))].map(lineId => {
        const oldTrips = previousBundle!.trips.filter(t => t.lineId === lineId), newTrips = prepared.bundle.trips.filter(t => t.lineId === lineId)
        const oldIds = new Map(oldTrips.map(t => [t.id, t])), newIds = new Set(newTrips.map(t => t.id))
        const times = (trips: TestTrip[]) => {
          const counts = new Map<string, number>()
          for (const trip of trips) for (const [station, seconds] of trip.stops) {
            const key = JSON.stringify([trip.serviceId, station, seconds]); counts.set(key, (counts.get(key) ?? 0) + 1)
          }
          return counts
        }
        const oldTimes = times(oldTrips), newTimes = times(newTrips)
        const subtract = (a: Map<string, number>, b: Map<string, number>) => [...a].reduce((n, [key, count]) => n + Math.max(0, count - (b.get(key) ?? 0)), 0)
        return { lineId, oldTrips: oldTrips.length, newTrips: newTrips.length, retiredIds: oldTrips.filter(t => !newIds.has(t.id)).length,
          newIds: newTrips.filter(t => !oldIds.has(t.id)).length, matchedIdsChanged: newTrips.filter(t => oldIds.has(t.id) && JSON.stringify(t.stops) !== JSON.stringify(oldIds.get(t.id)!.stops)).length,
          removedStopTimes: subtract(oldTimes, newTimes), addedStopTimes: subtract(newTimes, oldTimes) }
      })
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'timetable_%'").all().map(r => r.name)
    if (tables.length) {
      ensure(tables.includes('timetable_meta') && db.prepare('SELECT version FROM timetable_meta').get()?.version === 1, '未知时刻表数据库版本；拒绝迁移')
      const existing = db.prepare('SELECT id,report_json,bundle_json FROM timetable_imports WHERE hash=?').get(hash)
      if (existing) {
        prepared.bundle = JSON.parse(existing.bundle_json)
        report.version = prepared.bundle.version
        report.existingImportId = existing.id; report.backup = JSON.parse(existing.report_json).backup
      }
    }
    if (apply && !report.existingImportId) {
      const id = randomUUID(), backup = rollingBackup(path,destination=>db.prepare('VACUUM INTO ?').run(destination),'timetable',id,backupLocationFromEnv()).path
      report.importId = id; report.backup = backup
      db.exec('BEGIN IMMEDIATE')
      try {
        ensure(db.prepare('SELECT json FROM state WHERE id=1').get().json === before, '校验期间正式数据发生变化，请重试')
        db.exec(`CREATE TABLE IF NOT EXISTS timetable_meta(version INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS timetable_imports(id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status='test_enabled'), report_json TEXT NOT NULL, bundle_json TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS timetable_stations(import_id TEXT NOT NULL REFERENCES timetable_imports(id), source_id TEXT NOT NULL, station_id TEXT NOT NULL, line_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(import_id,source_id));
          CREATE TABLE IF NOT EXISTS timetable_trips(import_id TEXT NOT NULL REFERENCES timetable_imports(id), trip_id TEXT NOT NULL, service_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(import_id,trip_id));
          CREATE TABLE IF NOT EXISTS timetable_stop_times(import_id TEXT NOT NULL, trip_id TEXT NOT NULL, sequence INTEGER NOT NULL, station_id TEXT NOT NULL, departure_seconds INTEGER NOT NULL, basis TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(import_id,trip_id,sequence), FOREIGN KEY(import_id,trip_id) REFERENCES timetable_trips(import_id,trip_id));
          CREATE INDEX IF NOT EXISTS timetable_station_departures ON timetable_stop_times(import_id,station_id,departure_seconds);`)
        if (!tables.length) db.exec('INSERT INTO timetable_meta VALUES(1)')
        const now = new Date().toISOString()
        db.prepare('INSERT OR IGNORE INTO sources VALUES (?,?,?,?)').run(hash, archive, now, raw)
        db.prepare('INSERT INTO timetable_imports VALUES (?,?,?,?,?,?)').run(id, hash, now, 'test_enabled', JSON.stringify(report), JSON.stringify(prepared.bundle))
        const stationInsert = db.prepare('INSERT INTO timetable_stations VALUES (?,?,?,?,?)'), tripInsert = db.prepare('INSERT INTO timetable_trips VALUES (?,?,?,?)'), stopInsert = db.prepare('INSERT INTO timetable_stop_times VALUES (?,?,?,?,?,?,?)')
        for (const [sourceId, station] of prepared.stations) stationInsert.run(id, sourceId, station.id, station.lineId, JSON.stringify(station))
        for (const trip of prepared.bundle.trips) {
          tripInsert.run(id, trip.id, trip.serviceId, JSON.stringify(prepared.source.trips.find((t: RecordValue) => t.trip_id === trip.id)))
          for (const stop of prepared.stops.get(trip.id)!) stopInsert.run(id, trip.id, stop.stop_sequence, prepared.stations.get(stop.station_id)!.id, serviceSeconds(stop.departure_time || stop.arrival_time), !stop.is_stop ? 'source_pass_through_not_boardable' : stop.departure_time ? 'source_departure' : 'user_test_arrival_as_departure', JSON.stringify(stop))
        }
        ensure(db.prepare('SELECT COUNT(*) AS n FROM timetable_stop_times WHERE import_id=?').get(id).n === report.stopTimes, '写入数量校验失败')
        db.exec('COMMIT')
      } catch (e) { db.exec('ROLLBACK'); throw e }
    }
    ensure(db.prepare('SELECT json FROM state WHERE id=1').get().json === before, '正式导航状态意外变化')
    mkdirSync(output, { recursive: true })
    writeFileSync(resolve(output, 'preview.json'), JSON.stringify(report, null, 2))
    if (apply) {
      const backupName = resolve(output, report.sourceFileName)
      if (!existsSync(backupName)) copyFileSync(archive, backupName, constants.COPYFILE_EXCL)
      else ensure(sha(readFileSync(backupName)) === hash, '归档目录已有不同原件')
      writeFileSync(resolve(output, 'test-timetable.json'), JSON.stringify(prepared.bundle))
    }
    return { report, bundle: prepared.bundle }
  } finally { db.close() }
}
