import type JSZip from 'jszip'
import { parseCsv } from '../data-csv'
import { createHash } from 'node:crypto'
type Row = Record<string, any>
const check = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/** Explicit results/ variant selected by the user; never executes scripts supplied in the ZIP. */
export async function readResearchTimetable(zip: JSZip, base: Row): Promise<Row> {
  check(base?.trips?.length && base.stations?.BEX, '研究候选导入需要既有五线时刻版本，拒绝猜测基线')
  const read = async (name: string) => { const file = zip.file(name); check(file, `缺少 ${name}`); return (await file!.async('string')).replace(/^\uFEFF/, '') }
  const manifest = JSON.parse(await read('results/manifest_v1.2.json'))
  check(manifest.version === 'F1_to_wenling_v1.2' && manifest.database_count?.trips === 298, '未知研究候选版本')
  if (manifest.source_sha256) {
    const baseline = zip.file('source/F1_v1.1_frozen_all_stop_events.csv')
    check(baseline && createHash('sha256').update(await baseline.async('nodebuffer')).digest('hex') === manifest.source_sha256, '研究冻结基线SHA不一致')
  }
  const rows = parseCsv(await read('results/F1_v1.2_all_stop_events.csv')) as Record<string, string>[]
  check(rows.length === manifest.database_count.stop_events, '研究事件总数与manifest不一致')
  const groups = new Map<string, Row[]>(), seen = new Set<string>()
  for (const row of rows) {
    check(row.line_id === 'BEX' && ['to_fuzhou', 'to_wenling'].includes(row.direction) && ['local', 'limited_express', 'direct'].includes(row.train_type) && row.calendar === 'all_days', '研究线路/方向/类型/日历无效')
    check(!seen.has(`${row.trip_id}/${row.stop_seq}`), '研究事件键重复'); seen.add(`${row.trip_id}/${row.stop_seq}`)
    for (const kind of ['arrival', 'departure', 'pass']) if (row[`${kind}_s`] !== '') {
      const seconds = Number(row[`${kind}_s`])
      check(/^\d+$/.test(row[`${kind}_s`]) && seconds < 172800 && clock(seconds) === row[`${kind}_clock`], '研究秒数与时钟不一致')
    }
    check(row.pass_s !== '' ? row.arrival_s === '' && row.departure_s === '' : row.arrival_s !== '' || row.departure_s !== '', '通过事件与到发字段混淆')
    const group = groups.get(row.trip_id) ?? []; group.push(row); groups.set(row.trip_id, group)
  }
  check(groups.size === manifest.database_count.trips, '研究班次数不一致')
  for (const [kind, file] of [['arrival', 'arrivals'], ['departure', 'departures'], ['pass', 'passes']]) {
    const split = parseCsv(await read(`results/F1_v1.2_${file}.csv`)) as Record<string, string>[]
    const expected = rows.filter(row => row[`${kind}_s`] !== '')
    check(split.length === expected.length && split.length === manifest.database_count[file], '研究分表计数不一致')
    const index = new Map(expected.map(row => [`${row.trip_id}/${row.stop_seq}`, row]))
    for (const row of split) {
      const original = index.get(`${row.trip_id}/${row.stop_seq}`)
      check(original && row.direction === original.direction && row.train_type === original.train_type && row.station === original.station && row.time_seconds === original[`${kind}_s`] && row.time === original[`${kind}_clock`] && row.quality === original.confidence && row.source === original.source_kind, '研究分表与完整事件不一致')
      index.delete(`${row.trip_id}/${row.stop_seq}`)
    }
    check(index.size === 0, '研究分表缺少事件')
  }
  const stations = new Map(base.stations.BEX.map((s: Row) => [s.name, s]))
  const trips: Row[] = [], stops: Row[] = []
  for (const [id, values] of groups) {
    const ordered = values.sort((a, b) => Number(a.stop_seq) - Number(b.stop_seq)), first = ordered[0], last = ordered[ordered.length - 1]
    check(ordered.every((row, i) => Number(row.stop_seq) === i + 1 && row.direction === first.direction && row.train_type === first.train_type), '研究班次序号或元数据冲突')
    trips.push({ trip_id: id, line_id: 'BEX', direction_id: first.direction, origin: first.station, destination: last.station,
      train_type: first.train_type === 'direct' ? 'direct_express' : first.train_type, service_calendar: 'all_days',
      source: '用户选择的 results/F1_v1.2_all_stop_events.csv；原始来源见各事件', quality: first.train_type === 'local' ? 'research_model_v1_2' : 'research_mixed_v1_2' })
    for (const row of ordered) {
      const station = stations.get(row.station) as Row | undefined
      check(station, `研究车站无法匹配：${row.station}`)
      stops.push({ trip_id: id, line_id: 'BEX', direction_id: row.direction, stop_sequence: Number(row.stop_seq), station_id: station!.station_id,
        station_name: row.station, arrival_time: row.arrival_s !== '' ? clock(Number(row.arrival_s)) : row.pass_s !== '' ? clock(Number(row.pass_s)) : '',
        departure_time: row.departure_s !== '' ? clock(Number(row.departure_s)) : '', time_seconds: Number(row.arrival_s || row.departure_s || row.pass_s),
        is_stop: row.pass_s === '', research_event: row })
    }
  }
  return { ...base, generated_date: new Date().toISOString().slice(0, 10),
    trips: [...base.trips.filter((t: Row) => t.line_id !== 'BEX'), ...trips], stop_times: [...base.stop_times.filter((s: Row) => s.line_id !== 'BEX'), ...stops],
    source_caveats: { ...Object.fromEntries(Object.entries(base.source_caveats).filter(([key]) => !key.startsWith('BEX'))), previous_BEX_caveats: Object.fromEntries(Object.entries(base.source_caveats).filter(([key]) => key.startsWith('BEX'))), research_v1_2: { selected: 'results/', scope: '用户明确选择替换整套滨海快线298班，其他线路保持', manifest, caveat: '同日选参回溯拟合，未独立盲测；保留到站/发车/通过区别，不代表官方实测精度' } } }
}
