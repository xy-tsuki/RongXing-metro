import type JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { parseCsv } from '../data-csv'

type Row = Record<string, any>
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const scope = ['L1', 'L2', 'L4', 'L5']
const key = (r: Row) => `${r.trip_id}/${r.stop_sequence}`
const originKey = (r: Row, seconds: unknown) => `${r.line_id}/${r.direction}/${Number(seconds)}`
function seconds(value: string): number | null {
  if (value === '') return null
  ensure(/^\d+(?:\.0+)?$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) < 172800, '工作日秒数无效')
  return Number(value)
}
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

// Read only the selected full candidate; never execute the package's scripts or open its SQLite.
export async function readWorkdayResearch(zip: JSZip, base: Row | undefined, root: string): Promise<Row> {
  ensure(base?.trips?.length && base.stop_times?.length, '工作日补充必须基于已有正式时刻表')
  const hashes: Record<string, string> = {}
  const csv = async (name: string): Promise<Row[]> => {
    const file = zip.file(root + 'output/' + name); ensure(file, `工作日包缺少 ${name}`)
    const raw = await file.async('nodebuffer'); hashes[name] = createHash('sha256').update(raw).digest('hex')
    return parseCsv(raw.toString('utf8').replace(/^\uFEFF/, ''))
  }
  const rows = await csv('工作日_六条已运营线路_全网候选.csv')
  const rich = await csv('工作日_四线全天逐站事件.csv')
  const origins = await csv('工作日_四线双方向_全天始发候选.csv')
  const anchors = await csv('工作日_原始截图逐班分钟锚点.csv')
  const fills = await csv('工作日_推算补班清单.csv')
  const screenshots = await csv('截图文件与时间范围索引.csv')
  const summary = await csv('工作日_线路方向汇总.csv')
  const index = new Map<string, Row>(), groups = new Map<string, Row[]>()
  for (const row of rows) {
    ensure(row.trip_id && row.station && !index.has(key(row)), '工作日事件身份重复')
    ensure([...scope, 'L6', 'BEX'].includes(row.line_id) && row.calendar === (scope.includes(row.line_id) ? 'workday' : 'all_days'), '工作日日历或线路无效')
    ensure(row.model_version && row.evidence_status, '工作日模型或证据状态缺失')
    for (const kind of ['arrival', 'departure', 'pass']) seconds(row[`${kind}_seconds`])
    index.set(key(row), row)
    const group = groups.get(row.trip_id) ?? []; group.push(row); groups.set(row.trip_id, group)
  }
  const remaining = new Map([...index].filter(([, r]) => scope.includes(r.line_id)))
  const richIndex = new Map<string, Row>()
  for (const row of rich) {
    const full = remaining.get(key(row))
    ensure(full && Object.entries(full).every(([field, value]) => row[field] === value), '工作日四线详表与六线表不一致')
    richIndex.set(key(row), row); remaining.delete(key(row))
  }
  ensure(!remaining.size, '工作日四线详表事件缺失')
  for (const kind of ['arrival', 'departure']) {
    const expected = new Map([...richIndex].filter(([, r]) => r[`${kind}_seconds`] !== ''))
    for (const row of await csv(kind === 'arrival' ? '工作日_到达事件.csv' : '工作日_发车事件.csv')) {
      const full = expected.get(key(row))
      ensure(full && Object.entries(row).every(([field, value]) => full[field] === value), '工作日到发分表不一致')
      expected.delete(key(row))
    }
    ensure(!expected.size, '工作日到发分表缺失')
  }
  const images = new Map<string, Row>()
  for (const row of screenshots) {
    ensure(scope.includes(row.line_id) && !images.has(row.file_name) && row.source_path_relative.startsWith('source/') && zip.file(root + row.source_path_relative), '工作日原图引用缺失或重复')
    images.set(row.file_name, row)
  }
  const anchorMap = new Map<string, Row>(), fillMap = new Map<string, Row>()
  for (const row of anchors) {
    const id = originKey(row, seconds(row.reference_seconds)), image = images.get(row.candidate_source_screenshot)
    ensure(image && image.line_id === row.line_id && image.direction === row.direction && !anchorMap.has(id) && row.precision === 'minute', '工作日分钟锚点引用无效')
    anchorMap.set(id, row)
  }
  for (const row of fills) {
    const id = originKey(row, seconds(row.departure_seconds))
    ensure(!fillMap.has(id) && !anchorMap.has(id) && row.confidence === 'estimated_gap_fill' && row.reason, '工作日补班身份冲突')
    fillMap.set(id, row)
  }
  const originMap = new Map<string, Row>(), usedAnchors = new Set<string>(), usedFills = new Set<string>()
  for (const row of origins) {
    const id = originKey(row, seconds(row.departure_seconds)), anchor = anchorMap.get(id), fill = fillMap.get(id)
    ensure(!originMap.has(row.trip_id) && row.calendar === 'workday' && scope.includes(row.line_id) && !!anchor !== !!fill, '工作日始发候选来源不唯一')
    ensure(row.origin_anchor_type === (fill ? 'inferred_peak_gap' : 'Amap_reference_minute'), '工作日补班来源标记不一致')
    ;(fill ? usedFills : usedAnchors).add(id); originMap.set(row.trip_id, row)
  }
  ensure(usedFills.size === fills.length && usedAnchors.size === anchors.length && origins.length === fills.length + anchors.length, '工作日锚点/补班覆盖不完整')
  ensure(summary.length === 8 && new Set(summary.map(r => `${r.line_id}/${r.direction}`)).size === 8, '工作日方向汇总不完整')
  for (const row of summary) {
    const selected = origins.filter(r => r.line_id === row.line_id && r.direction === row.direction)
    ensure(scope.includes(row.line_id) && selected.length === Number(row.weekday_candidate_trips) && selected.filter(r => r.origin_anchor_type === 'inferred_peak_gap').length === Number(row.inferred_gap_trips) && selected.length - Number(row.inferred_gap_trips) === Number(row.visually_transcribed_source_trips), '工作日方向班次数不一致')
  }
  // Daily lines in this package are context, not updates. Verify clocks against the baseline.
  const daily = base.trips.filter((t: Row) => ['L6', 'BEX'].includes(t.line_id))
  ensure(daily.length === [...groups.values()].filter(g => !scope.includes(g[0].line_id)).length, '每日线路班次数与正式版本不同')
  const baseEvents = new Map<string, Row>(base.stop_times.map((s: Row) => [key(s), s]))
  for (const trip of daily) {
    const values = groups.get(trip.trip_id)
    ensure(values && trip.service_calendar === 'all_days', '每日线路班次与正式版本不同')
    ensure(values.every(row => row.train_type === (trip.train_type === 'direct_express' ? 'direct' : trip.train_type)), '每日线路列车类型与正式版本不同')
    const expected = base.stop_times.filter((s: Row) => s.trip_id === trip.trip_id)
    ensure(values.length === expected.length, '每日线路事件数与正式版本不同')
    for (const row of values) {
      const old = baseEvents.get(key(row)), a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds), p = seconds(row.pass_seconds)
      ensure(old && old.station_name === row.station && old.line_id === row.line_id && old.direction_id === row.direction && old.is_stop === (p === null) && old.time_seconds === (a ?? p ?? d) && old.departure_time === (d === null ? '' : clock(d)), '每日线路时刻与正式版本不同，拒绝覆盖')
    }
  }
  const trips: Row[] = [], stopTimes: Row[] = []
  for (const [id, values] of groups) {
    if (!scope.includes(values[0].line_id)) continue
    const ordered = values.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence)), first = ordered[0], last = ordered.at(-1)!, origin = originMap.get(id)
    ensure(origin && origin.line_id === first.line_id && origin.direction === first.direction && origin.origin_station === first.station && Number(origin.departure_seconds) === seconds(first.departure_seconds), '工作日始发与逐站表不一致')
    ensure(ordered.length === base.stations[first.line_id].length, '工作日全天班次缺少车站')
    const fill = fillMap.get(originKey(origin, origin.departure_seconds))
    for (const [i, row] of ordered.entries()) {
      ensure(Number(row.stop_sequence) === i + 1 && ['line_id', 'direction', 'calendar', 'train_type'].every(field => row[field] === first[field]) && row.train_type === 'local' && row.pass_seconds === '', '工作日班次站序/方向/类型不一致')
      const station = base.stations[row.line_id]?.find((s: Row) => s.name === row.station), a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds)
      ensure(station && (a !== null || d !== null), '工作日车站引用或时刻无效')
      stopTimes.push({ trip_id: id, line_id: row.line_id, direction_id: row.direction, stop_sequence: i + 1, station_id: station.station_id, station_name: row.station, arrival_time: a === null ? '' : clock(a), departure_time: d === null ? '' : clock(d), time_seconds: a ?? d, is_stop: true, research_event: row, source_line_event: richIndex.get(key(row)) })
    }
    trips.push({ trip_id: id, line_id: first.line_id, direction_id: first.direction, origin: first.station, destination: last.station, train_type: 'local', service_calendar: 'workday', source: '工作日v1.0研究候选；高德分钟到达按用户测试政策视作发车，中间站按休息日模型推算', quality: fill ? 'research_workday_gap_fill_v1_0_estimated_other_stops' : 'research_workday_v1_0_estimated_other_stops', origin_evidence: origin, gap_fill_evidence: fill ?? null, source_anchor: anchorMap.get(originKey(origin, origin.departure_seconds)) ?? null })
  }
  ensure(trips.length === origins.length, '工作日班次覆盖不完整')
  const replaced = new Set(base.trips.filter((t: Row) => scope.includes(t.line_id) && t.service_calendar === 'workday').map((t: Row) => t.trip_id))
  const retained = base.trips.filter((t: Row) => !replaced.has(t.trip_id))
  ensure(!trips.some(t => retained.some((r: Row) => r.trip_id === t.trip_id)), '工作日班次ID与保留数据冲突')
  return { ...base, generated_date: '2026-10-19', trips: [...retained, ...trips], stop_times: [...base.stop_times.filter((s: Row) => !replaced.has(s.trip_id)), ...stopTimes], source_caveats: { ...base.source_caveats, research_workday_v1_0: { selected: 'output/工作日_六条已运营线路_全网候选.csv', includeGapFill: true, weekdayTrips: trips.length, inferredGapTrips: fills.length, sourceAnchors: anchors.length, screenshots: screenshots.length, selectedFileHashes: hashes, directionSummary: summary, caveat: '研究候选，非官方精确时刻；包含用户启用的推算补班。高德到达分钟按测试政策作为发车，中间站推算，L4短班距与L5晚末班保留待核实；休息日及每日数据保持原样。' } } }
}
