import type JSZip from 'jszip'
import { createHash } from 'node:crypto'
import type { MetroDataset } from '../../src/core/types'
import { parseCsv } from '../data-csv'

type Row = Record<string, any>
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
function seconds(value: string): number | null {
  if (value === '') return null
  ensure(/^\d+(?:\.0+)?$/.test(value), '六线秒数必须为非负整数或未知空白')
  const n = Number(value)
  ensure(Number.isSafeInteger(n) && n < 172800, '六线时刻秒数超限')
  return n
}
const eventKey = (row: Row) => `${row.trip_id}/${row.stop_sequence}`
const kinds = ['arrival', 'departure', 'pass'] as const
export async function readSixLineResearch(zip: JSZip, dataset: MetroDataset, root: string): Promise<Row> {
  const hashes: Record<string, string> = {}
  const text = async (name: string) => {
    const file = zip.file(root + 'output/' + name)
    ensure(file, `六线包缺少 ${name}`)
    const raw = await file.async('nodebuffer')
    hashes[name] = createHash('sha256').update(raw).digest('hex')
    return raw.toString('utf8').replace(/^\uFEFF/, '')
  }
  const csv = async (name: string) => parseCsv(await text(name)) as Record<string, string>[]
  const rows = await csv('休息日六运营线路_统一逐站候选.csv')
  const qa = JSON.parse(await text('质量审计.json'))
  const counts = await csv('完整性_线路班次统计.csv')
  ensure(rows.length === qa.six_line_stop_events && Number.isInteger(qa.six_line_trips), '六线审计总数不一致')
  const expectedLines = ['L1', 'L2', 'L4', 'L5', 'L6', 'BEX']
  ensure(counts.length === 6 && new Set(counts.map(r => r.line_id)).size === 6 && expectedLines.every(id => counts.some(r => r.line_id === id)), '六线统计线路缺失或重复')
  const index = new Map<string, Row>(), groups = new Map<string, Row[]>()
  for (const row of rows) {
    ensure(row.trip_id && row.station && expectedLines.includes(row.line_id) && !index.has(eventKey(row)), '六线事件身份重复或线路无效')
    ensure(row.calendar === (['L6', 'BEX'].includes(row.line_id) ? 'all_days' : 'rest_day'), '六线日历无效，不导入工作日理论表')
    ensure(['local', 'limited_express', 'direct'].includes(row.train_type) && (row.line_id === 'BEX' || row.train_type === 'local'), '六线列车类型无效')
    const a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds), p = seconds(row.pass_seconds)
    ensure(p === null ? a !== null || d !== null : a === null && d === null, '通过事件不能同时作为上下客到发事件')
    ensure(a === null || d === null || d >= a, '六线发车早于到站')
    ensure(row.model_version && row.evidence_status, '六线事件缺少模型及证据状态')
    index.set(eventKey(row), row)
    const group = groups.get(row.trip_id) ?? []; group.push(row); groups.set(row.trip_id, group)
  }
  ensure(groups.size === qa.six_line_trips, '六线班次数不一致')
  for (const count of counts) {
    ensure(rows.filter(r => r.line_id === count.line_id).length === Number(count.station_events) && [...groups.values()].filter(g => g[0].line_id === count.line_id).length === Number(count.trips), '六线逐线路计数不一致')
  }
  // All three split exports must contain exactly the corresponding events of the unified table.
  for (const kind of kinds) {
    const remaining = new Map([...index].filter(([, r]) => r[`${kind}_seconds`] !== ''))
    for (const row of await csv(`休息日六线_${kind}_events.csv`)) {
      const full = remaining.get(eventKey(row))
      ensure(full && Object.keys(full).length === Object.keys(row).length && Object.entries(full).every(([field, value]) => row[field] === value), '六线到发通过分表与统一表不一致')
      remaining.delete(eventKey(row))
    }
    ensure(remaining.size === 0, '六线到发通过分表缺失事件')
  }
  // Cross-check the richer line-specific exports and retain them with the source evidence.
  const rich = new Map<string, Row>()
  for (const [name, scope] of [
    ['L1245_节假日逐站到发_v3.1.csv', ['L1', 'L2', 'L4', 'L5']],
    ['L6_每天通用_逐站到发_v2.1_冻结.csv', ['L6']],
    ['F1_每天通用_逐站到发_v1.1_冻结.csv', ['BEX']],
  ] as const) {
    const remaining = new Map([...index].filter(([, r]) => (scope as readonly string[]).includes(r.line_id)))
    for (const row of await csv(name)) {
      const normalized: Record<string, string> = scope[0] === 'BEX' ? { ...row, stop_sequence: row.stop_seq, arrival_seconds: row.arrival_s, departure_seconds: row.departure_s, pass_seconds: row.pass_s } : { pass_seconds: '', ...row }
      const key = eventKey(normalized), full = remaining.get(key)
      ensure(full && ['line_id', 'direction', 'station', 'train_type'].every(field => full[field] === normalized[field]) && full.calendar === (normalized.calendar ?? normalized.service_calendar), '六线单线表身份不一致')
      ensure(kinds.every(kind => seconds(full[`${kind}_seconds`]) === seconds(normalized[`${kind}_seconds`])), '六线单线表到发时刻不一致')
      rich.set(key, row); remaining.delete(key)
    }
    ensure(remaining.size === 0, '六线单线表缺失事件')
  }
  const lines: Row[] = [], stations: Record<string, Row[]> = {}
  for (const id of expectedLines) {
    const line = dataset.lines.find(l => l.id === (id === 'BEX' ? 'fz-f1' : `fz-${id.toLowerCase()}`))
    const service = dataset.services.find(s => s.lineId === line?.id)
    ensure(line && service, `六线线路未建模：${id}`)
    lines.push({ line_id: id, name: line.name })
    stations[id] = service.stops.map((stop, order) => {
      const station = dataset.stations.find(s => s.id === stop.stationId)!
      return { station_id: `${id}:${station.id}`, name: id === 'BEX' && station.name === '三叉街（滨海快线）' ? '三叉街' : station.name, order: order + 1 }
    })
  }
  const trips: Row[] = [], stopTimes: Row[] = []
  for (const [id, group] of groups) {
    const ordered = group.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)), first = ordered[0], last = ordered[ordered.length - 1]
    ensure(ordered.every((r, i) => Number(r.stop_sequence) === i + 1 && ['line_id', 'direction', 'calendar', 'train_type'].every(field => r[field] === first[field])), '六线班次方向冲突或站序不连续')
    let priorDeparture: number | null = null
    for (const row of ordered) {
      const a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds), p = seconds(row.pass_seconds)
      const arrival = a ?? p ?? d!, departure = d ?? p ?? a!
      ensure(priorDeparture === null || arrival > priorDeparture, '六线区间运行时间须大于零')
      priorDeparture = departure
      const station = stations[row.line_id].find(s => s.name === row.station)
      ensure(station, `六线车站无法匹配：${row.line_id}/${row.station}`)
      stopTimes.push({ trip_id: id, line_id: row.line_id, direction_id: row.direction, stop_sequence: Number(row.stop_sequence), station_id: station.station_id, station_name: row.station,
        arrival_time: a !== null ? clock(a) : p !== null ? clock(p) : '', departure_time: d !== null ? clock(d) : '', time_seconds: arrival, is_stop: p === null,
        research_event: row, source_line_event: rich.get(eventKey(row)) })
    }
    const quality = first.line_id === 'BEX' ? first.train_type === 'local' ? 'research_model_v1_1' : 'research_mixed_v1_1' : first.line_id === 'L6' ? 'research_l6_v2_1' : 'research_rest_six_v3_1'
    trips.push({ trip_id: id, line_id: first.line_id, direction_id: first.direction, origin: first.station, destination: last.station,
      train_type: first.train_type === 'direct' ? 'direct_express' : first.train_type, service_calendar: first.calendar, source: '六线休息日v3.1研究候选；未独立盲测，来源模型见事件', quality })
  }
  return { schema_version: '0.2', generated_date: '2026-10-19', lines, stations, trips, stop_times: stopTimes,
    source_caveats: { research_six_v3_1: { selected: 'output/休息日六运营线路_统一逐站候选.csv', qa, selectedFileHashes: hashes,
      frozenVersions: { BEX: 'v1.1', L6: 'v2.1' }, caveat: '整包研究候选，非官方秒级时刻；截图已参与选参，非独立盲测；不导入source/work_day_v2_theoretical_UNVALIDATED.csv' } } }
}
