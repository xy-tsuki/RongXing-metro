import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import raw from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { toCsv } from '../scripts/data-csv'
import { readWorkdayResearch } from '../scripts/maintenance/research-workday'
import { prepareTimetable } from '../scripts/maintenance/timetable-import'

async function fixture(tamper = '') {
  const zip = new JSZip(), root = 'synthetic/', out = root + 'output/'
  const base: any = { schema_version: '0.2', lines: [], stations: {}, trips: [], stop_times: [], source_caveats: { retained: true } }
  const rows: any[] = [], origins: any[] = [], anchors: any[] = [], fills: any[] = [], images: any[] = [], summary: any[] = []
  for (const id of ['L1', 'L2', 'L4', 'L5']) {
    const line = raw.lines.find(l => l.id === `fz-${id.toLowerCase()}`)!
    base.lines.push({ line_id: id, name: line.name })
    const services = raw.services.filter(s => s.lineId === line.id)
    base.stations[id] = services[0].stops.map((s, i) => ({ station_id: `${id}:${s.stationId}`, name: raw.stations.find(x => x.id === s.stationId)!.name, order: i + 1 }))
    for (const [directionIndex, service] of services.entries()) {
      const trip_id = `synthetic-${id}-${directionIndex}`, direction = service.id, fill = id === 'L1' && directionIndex === 0
      const stationName = (stationId: string) => raw.stations.find(s => s.id === stationId)!.name
      const origin_anchor_type = fill ? 'inferred_peak_gap' : 'Amap_reference_minute'
      origins.push({ trip_id, line_id: id, direction, calendar: 'workday', origin_station: stationName(service.stops[0].stationId), departure_seconds: '21600', origin_anchor_type })
      if (fill) fills.push({ line_id: id, direction, departure_seconds: '21600', confidence: 'estimated_gap_fill', reason: 'synthetic' })
      else {
        const file_name = `${trip_id}.jpg`, source_path_relative = `source/${file_name}`
        images.push({ line_id: id, direction, file_name, source_path_relative }); zip.file(root + source_path_relative, 'synthetic image placeholder')
        anchors.push({ line_id: id, direction, reference_seconds: '21600', precision: 'minute', candidate_source_screenshot: file_name })
      }
      summary.push({ line_id: id, direction, weekday_candidate_trips: '1', inferred_gap_trips: fill ? '1' : '0', visually_transcribed_source_trips: fill ? '0' : '1' })
      service.stops.forEach((stop, i) => rows.push({ trip_id, line_id: id, direction, calendar: 'workday', station: stationName(stop.stationId), stop_sequence: String(i + 1), train_type: 'local', arrival_seconds: i ? String(21600 + i * 120) : '', departure_seconds: i < service.stops.length - 1 ? String(21600 + i * 120) : '', pass_seconds: '', model_version: 'synthetic', evidence_status: 'synthetic' }))
    }
    const first = rows.find(r => r.line_id === id)
    base.trips.push({ trip_id: `rest-${id}`, service_calendar: 'rest_day', line_id: id })
    base.stop_times.push({ trip_id: `rest-${id}`, immutable: true })
    expect(first).toBeTruthy()
  }
  const rich = rows.map(r => ({ ...r }))
  if (tamper === 'calendar') rows[0].calendar = 'all_days'
  if (tamper === 'rich') rich[0].departure_seconds = '22222'
  if (tamper === 'fill') origins[0].origin_anchor_type = 'Amap_reference_minute'
  if (tamper === 'image') zip.remove(root + images[0].source_path_relative)
  if (tamper === 'duplicate') rows.push({ ...rows[0] })
  zip.file(out + '工作日_六条已运营线路_全网候选.csv', toCsv(rows))
  zip.file(out + '工作日_四线全天逐站事件.csv', toCsv(rich))
  for (const kind of ['arrival', 'departure']) {
    const split = rich.filter(r => r[`${kind}_seconds`] !== '').map(r => ({ ...r }))
    if (tamper === 'split' && kind === 'arrival') split.pop()
    zip.file(out + (kind === 'arrival' ? '工作日_到达事件.csv' : '工作日_发车事件.csv'), toCsv(split))
  }
  for (const [file, values] of [['工作日_四线双方向_全天始发候选.csv', origins], ['工作日_原始截图逐班分钟锚点.csv', anchors], ['工作日_推算补班清单.csv', fills], ['截图文件与时间范围索引.csv', images], ['工作日_线路方向汇总.csv', summary]] as const) zip.file(out + file, toCsv(values))
  return { zip, base, root }
}
describe('workday candidate merge', () => {
  it('keeps rest-day source rows unchanged and tags explicitly enabled inferred trains', async () => {
    const { zip, base, root } = await fixture()
    const result = await readWorkdayResearch(zip, base, root)
    expect(result.trips.slice(0, 4)).toEqual(base.trips)
    expect(result.stop_times.slice(0, 4)).toEqual(base.stop_times)
    expect(result.trips.filter((t: any) => t.quality?.includes('gap_fill'))).toHaveLength(1)
    expect(result.source_caveats.research_workday_v1_0.inferredGapTrips).toBe(1)
    expect(result.trips.filter((t: any) => t.service_calendar === 'workday')).toHaveLength(8)
  })
  it.each(['calendar', 'rich', 'fill', 'image', 'duplicate', 'split'])('rejects %s before writing', async tamper => {
    const { zip, base, root } = await fixture(tamper)
    await expect(readWorkdayResearch(zip, base, root)).rejects.toThrow()
  })
  it('rejects a supplement without an existing baseline', async () => {
    const { zip } = await fixture()
    await expect(prepareTimetable(await zip.generateAsync({ type: 'nodebuffer' }), raw as MetroDataset)).rejects.toThrow('已有正式时刻表')
  })
})
