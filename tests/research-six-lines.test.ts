import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import raw from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { toCsv } from '../scripts/data-csv'
import { prepareTimetable } from '../scripts/maintenance/timetable-import'

async function fixture(tamper?: 'split' | 'calendar' | 'seconds' | 'line-export') {
  const zip = new JSZip(), root = 'synthetic-six/output/', rows: Record<string, string>[] = []
  for (const id of ['L1', 'L2', 'L4', 'L5', 'L6', 'BEX']) {
    const service = raw.services.find(s => s.lineId === (id === 'BEX' ? 'fz-f1' : `fz-${id.toLowerCase()}`))!
    for (const [i, stop] of service.stops.slice(0, id === 'BEX' ? 3 : 2).entries()) {
      const pass = id === 'BEX' && i === 1
      const last = i === (id === 'BEX' ? 2 : 1)
      rows.push({ trip_id: `test-${id}`, line_id: id, calendar: ['L6', 'BEX'].includes(id) ? 'all_days' : 'rest_day', direction: 'synthetic-forward', train_type: id === 'BEX' ? 'direct' : 'local', stop_sequence: String(i + 1), station: raw.stations.find(s => s.id === stop.stationId)!.name,
        arrival_seconds: i && !pass ? String(21600 + 120 * i) + '.0' : '', departure_seconds: !i ? '21600.0' : '', pass_seconds: pass ? '21720.0' : '', model_version: 'synthetic-candidate', evidence_status: 'synthetic-not-field-evidence' })
      if (last) rows.at(-1)!.departure_seconds = ''
    }
  }
  if (tamper === 'calendar') rows[0].calendar = 'workday'
  if (tamper === 'seconds') rows[0].departure_seconds = '21600.5'
  zip.file(root + '休息日六运营线路_统一逐站候选.csv', toCsv(rows))
  for (const kind of ['arrival', 'departure', 'pass']) {
    const selected = rows.filter(r => r[`${kind}_seconds`] !== '').map(r => ({ ...r }))
    if (tamper === 'split' && kind === 'departure') selected[0].departure_seconds = '22222.0'
    zip.file(root + `休息日六线_${kind}_events.csv`, toCsv(selected))
  }
  const four: Record<string, string>[] = rows.filter(r => ['L1', 'L2', 'L4', 'L5'].includes(r.line_id)).map(r => ({ ...r, service_calendar: r.calendar }))
  if (tamper === 'line-export') four[0].departure_seconds = '22222.0'
  zip.file(root + 'L1245_节假日逐站到发_v3.1.csv', toCsv(four))
  zip.file(root + 'L6_每天通用_逐站到发_v2.1_冻结.csv', toCsv(rows.filter(r => r.line_id === 'L6').map(r => ({ ...r, service_calendar: r.calendar }))))
  zip.file(root + 'F1_每天通用_逐站到发_v1.1_冻结.csv', toCsv(rows.filter(r => r.line_id === 'BEX').map(r => ({ ...r, stop_seq: r.stop_sequence, arrival_s: r.arrival_seconds, departure_s: r.departure_seconds, pass_s: r.pass_seconds }))))
  zip.file(root + '完整性_线路班次统计.csv', toCsv(['L1', 'L2', 'L4', 'L5', 'L6', 'BEX'].map(id => ({ line_id: id, trips: 1, station_events: rows.filter(r => r.line_id === id).length }))))
  zip.file(root + '质量审计.json', JSON.stringify({ six_line_trips: 6, six_line_stop_events: rows.length }))
  zip.file('synthetic-six/source/work_day_v2_theoretical_UNVALIDATED.csv', 'must not be read as timetable')
  return zip.generateAsync({ type: 'nodebuffer' })
}
describe('six-line v3.1 read-only candidate adapter', () => {
  it('preserves candidate evidence, separates pass events, includes L6 and maps explicit direct type', async () => {
    const prepared = await prepareTimetable(await fixture(), raw as MetroDataset)
    expect(prepared.report.importFormat).toBe('research-rest-six-v3.1')
    expect(prepared.bundle.trips).toHaveLength(6)
    expect(prepared.report.passThroughEvents).toBe(1)
    expect(prepared.bundle.trips.find(t => t.lineId === 'fz-f1')!.type).toBe('direct_express')
    expect(prepared.bundle.trips.find(t => t.lineId === 'fz-f1')!.stops).toHaveLength(2)
    expect(prepared.bundle.trips.find(t => t.lineId === 'fz-l6')!.calendar).toBe('all_days')
    expect(prepared.source.stop_times[0].research_event.evidence_status).toBe('synthetic-not-field-evidence')
    expect(prepared.source.stop_times[0].source_line_event.departure_seconds).toBe('21600.0')
    expect(prepared.bundle.trips.some(t => t.calendar === 'workday')).toBe(false)
  })
  it.each(['split', 'calendar', 'seconds', 'line-export'] as const)('rejects %s inconsistencies before any write', async tamper => {
    await expect(prepareTimetable(await fixture(tamper), raw as MetroDataset)).rejects.toThrow()
  })
})
