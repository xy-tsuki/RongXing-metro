import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { openTimetableDatabase, serviceSeconds } from './maintenance/timetable-import'

const path = resolve(process.env.RONGXING_DATA_DIR ?? 'output/maintenance-data', 'rongxing.sqlite')
const output = resolve(process.env.RONGXING_TIMETABLE_OUTPUT ?? 'output/timetable-import-20261017')
const db = openTimetableDatabase(path)
try {
  const record = db.prepare('SELECT * FROM timetable_imports ORDER BY rowid DESC LIMIT 1').get()
  assert(record, 'No imported timetable')
  const report = JSON.parse(record.report_json), bundle = JSON.parse(record.bundle_json)
  assert.deepEqual(JSON.parse(readFileSync(process.env.RONGXING_PUBLIC_BUNDLE_PATH ?? 'src/data/timetable-test.json', 'utf8')), bundle)
  const source = db.prepare('SELECT raw FROM sources WHERE hash=?').get(record.hash)
  assert.equal(createHash('sha256').update(source.raw).digest('hex'), record.hash)
  assert.equal(record.hash, createHash('sha256').update(readFileSync(resolve(output, report.sourceFileName ?? 'source.zip'))).digest('hex'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timetable_trips WHERE import_id=?').get(record.id).n, report.trips)
  const stops = db.prepare('SELECT * FROM timetable_stop_times WHERE import_id=?').all(record.id)
  assert.equal(stops.length, report.stopTimes)
  const tripMap = new Map<string, any>(bundle.trips.map((t: any) => [t.id, t]))
  for (const row of stops) {
    const original = JSON.parse(row.json), trip = tripMap.get(row.trip_id)
    assert.equal(row.departure_seconds, serviceSeconds(original.departure_time || original.arrival_time))
    const publicStop = trip.stops.find((s: any) => s[0] === row.station_id)
    if (original.is_stop) assert.deepEqual(publicStop, [row.station_id, row.departure_seconds])
    else { assert.equal(publicStop, undefined); assert.equal(row.basis, 'source_pass_through_not_boardable') }
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  const backup = openTimetableDatabase(report.backup)
  let unchangedOtherLineEvents: number | undefined
  try {
    assert.equal(db.prepare('SELECT json FROM state WHERE id=1').get().json, backup.prepare('SELECT json FROM state WHERE id=1').get().json)
    if (['research-results-v1.2-full-BEX','research-L1245-H1','research-workday-six-v1.0','research-workday-csv-v2.0'].includes(report.importFormat)) {
      const previous = backup.prepare('SELECT id FROM timetable_imports ORDER BY rowid DESC LIMIT 1').get()
      const predicate = report.importFormat.startsWith('research-workday') ? "trip_id NOT IN (SELECT trip_id FROM timetable_trips WHERE json_extract(json,'$.service_calendar')='workday')" : `json_extract(json,'$.line_id')${report.importFormat === 'research-L1245-H1' ? "='BEX'" : "<>'BEX'"}`
      const otherTrips = `SELECT trip_id,service_id,json FROM timetable_trips WHERE import_id=? AND ${predicate} ORDER BY trip_id`
      const otherEvents = `SELECT trip_id,sequence,station_id,departure_seconds,basis,json FROM timetable_stop_times WHERE import_id=? AND ${predicate} ORDER BY trip_id,sequence`
      assert.deepEqual(db.prepare(otherTrips).all(record.id), backup.prepare(otherTrips).all(previous.id))
      const oldEvents = backup.prepare(otherEvents).all(previous.id)
      assert.deepEqual(db.prepare(otherEvents).all(record.id), oldEvents)
      unchangedOtherLineEvents = oldEvents.length
    }
  } finally { backup.close() }
  const evidence = { result: 'PASS', version: bundle.version, importId: record.id, sourceHash: record.hash, lines: report.lines, trips: report.trips,
    verifiedStopTimes: stops.length, unchangedOtherLineEvents, boardingStopTimes: bundle.trips.reduce((n: number, t: any) => n + t.stops.length, 0), passThroughEvents: stops.filter(row => !JSON.parse(row.json).is_stop).length, originalStateUnchanged: true, originalSourcePreserved: true, publicBundleMatchesDatabase: true, foreignKeys: 'PASS', integrity: 'ok', backup: report.backup }
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence, null, 2))
} finally { db.close() }
