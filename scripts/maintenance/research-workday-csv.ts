import { parseCsv } from '../data-csv'
import { createHash } from 'node:crypto'
type Row = Record<string, any>
function ensure(v: unknown, message: string): asserts v { if (!v) throw new Error(message) }
const scope = ['L1','L2','L4','L5']
function seconds(v: string): number | null {
  if (v === '') return null
  ensure(/^\d+(?:\.0+)?$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) < 172800, '工作日CSV秒数无效')
  return Number(v)
}
const clock = (n: number) => `${String(Math.floor(n / 3600)).padStart(2,'0')}:${String(Math.floor(n % 3600 / 60)).padStart(2,'0')}:${String(n % 60).padStart(2,'0')}`
export function readWorkdayCsv(raw: Buffer, base: Row | undefined): Row {
  ensure(raw.length <= 12 * 1024 * 1024 && base?.trips?.length && base.stop_times?.length, '工作日CSV超限或缺少已有时刻基线')
  const rows = parseCsv(raw.toString('utf8').replace(/^\uFEFF/,'')) as Row[]
  ensure(rows.length > 0 && rows.length <= 100000, '工作日CSV事件数量无效')
  const fields = ['trip_id','line_id','calendar','direction','train_type','stop_sequence','station','arrival_seconds','departure_seconds','pass_seconds','model_version','evidence_status','phase_robustness_shift_seconds']
  ensure(fields.every(f => Object.prototype.hasOwnProperty.call(rows[0], f)) && Object.keys(rows[0]).length === fields.length, '工作日CSV字段不匹配')
  const groups = new Map<string, Row[]>(), ids = new Set<string>()
  for (const row of rows) {
    const id = `${row.trip_id}/${row.stop_sequence}`, weekday = scope.includes(row.line_id)
    ensure(row.trip_id && row.direction && row.station && !ids.has(id), '工作日CSV事件重复或身份缺失'); ids.add(id)
    ensure([...scope,'L6','BEX'].includes(row.line_id) && row.calendar === (weekday ? 'workday' : 'all_days'), '工作日CSV线路或日历错误')
    ensure(row.evidence_status && (weekday ? row.model_version === 'v2.0_two_parameter_smooth_phase_RESEARCH' : row.model_version === 'v1.1_untouched'), '工作日CSV模型或证据状态错误')
    ensure(/^\d+$/.test(row.phase_robustness_shift_seconds), '工作日CSV相位标记无效')
    const a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds), p = seconds(row.pass_seconds)
    ensure(p === null ? a !== null || d !== null : a === null && d === null, '通过和上下客事件冲突')
    ensure(a === null || d === null || d >= a, '发车早于到站')
    const g = groups.get(row.trip_id) ?? []; g.push(row); groups.set(row.trip_id,g)
  }
  const dailyTrips = base.trips.filter((t: Row) => ['L6','BEX'].includes(t.line_id))
  const dailyEvents = new Map<string, Row>(base.stop_times.filter((s: Row) => ['L6','BEX'].includes(s.line_id)).map((s: Row) => [`${s.trip_id}/${s.stop_sequence}`,s]))
  const remaining = new Set(dailyEvents.keys())
  ensure(dailyTrips.length === [...groups.values()].filter(g => !scope.includes(g[0].line_id)).length, '每日线路班次数与正式基线不同')
  for (const trip of dailyTrips) {
    const g = groups.get(trip.trip_id)
    ensure(g && trip.service_calendar === 'all_days', '每日班次与正式基线不同')
    for (const row of g) {
      const id = `${row.trip_id}/${row.stop_sequence}`, old = dailyEvents.get(id), a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds), p = seconds(row.pass_seconds)
      ensure(old && remaining.delete(id) && row.calendar === 'all_days' && old.line_id === row.line_id && old.direction_id === row.direction && old.station_name === row.station && row.train_type === (trip.train_type === 'direct_express' ? 'direct' : trip.train_type) && old.is_stop === (p === null) && old.time_seconds === (a ?? p ?? d) && old.arrival_time === (a !== null ? clock(a) : p !== null ? clock(p) : '') && old.departure_time === (d === null ? '' : clock(d)), '每日线路时刻与正式基线不同，拒绝覆盖')
    }
  }
  ensure(!remaining.size, '每日线路事件缺失')
  const trips: Row[] = [], stops: Row[] = [], directions = new Set<string>()
  for (const [id,g] of groups) {
    if (!scope.includes(g[0].line_id)) continue
    g.sort((a,b) => Number(a.stop_sequence)-Number(b.stop_sequence))
    const first = g[0], last = g.at(-1)!
    ensure(g.length === base.stations[first.line_id]?.length, '工作日班次缺站')
    directions.add(`${first.line_id}/${first.direction}`)
    for (const [i,row] of g.entries()) {
      ensure(Number(row.stop_sequence) === i+1 && ['line_id','direction','calendar','train_type','phase_robustness_shift_seconds'].every(f => row[f] === first[f]) && row.train_type === 'local' && row.pass_seconds === '', '工作日班次方向、站序或类型冲突')
      const station = base.stations[row.line_id].find((s: Row) => s.name === row.station), a = seconds(row.arrival_seconds), d = seconds(row.departure_seconds)
      ensure(station, '工作日车站引用无效')
      stops.push({ trip_id:id,line_id:row.line_id,direction_id:row.direction,stop_sequence:i+1,station_id:station.station_id,station_name:row.station,arrival_time:a===null?'':clock(a),departure_time:d===null?'':clock(d),time_seconds:a??d,is_stop:true,research_event:row })
    }
    trips.push({trip_id:id,line_id:first.line_id,direction_id:first.direction,origin:first.station,destination:last.station,train_type:'local',service_calendar:'workday',source:'工作日v2.0全日逐站研究CSV；固定区间拟合及相位修正，非官方精确时刻',quality:'research_workday_v2_0_estimated_other_stops',model_version:first.model_version,evidence_status:first.evidence_status,phase_robustness_shift_seconds:Number(first.phase_robustness_shift_seconds)})
  }
  ensure(directions.size === 8 && scope.every(line => [...directions].filter(d => d.startsWith(line+'/')).length === 2), '工作日四线方向覆盖不完整')
  const replaced = new Set(base.trips.filter((t: Row) => scope.includes(t.line_id) && t.service_calendar === 'workday').map((t: Row) => t.trip_id))
  const keep = base.trips.filter((t: Row) => !replaced.has(t.trip_id)), keepIds = new Set(keep.map((t: Row) => t.trip_id))
  ensure(!trips.some(t => keepIds.has(t.trip_id)), '工作日班次ID与保留范围冲突')
  return {...base,generated_date:'2026-10-20',trips:[...keep,...trips],stop_times:[...base.stop_times.filter((s: Row) => !replaced.has(s.trip_id)),...stops],source_caveats:{...base.source_caveats,research_workday_csv_v2_0:{sha256:createHash('sha256').update(raw).digest('hex'),weekdayTrips:trips.length,weekdayEvents:stops.length,selected:'weekday_v2.0_full_day_stop_events.csv',caveat:'研究CSV单表，未提供独立分表/原图交叉证据；非官方精确时刻。保留源模型、证据与相位修正；仅替换四线工作日，其他日历及每日线路原JSON不变。'}}}
}
