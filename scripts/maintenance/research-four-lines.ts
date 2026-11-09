import type JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { parseCsv } from '../data-csv'
type Row = Record<string, any>
const ensure = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2,'0')}:${String(Math.floor(s % 3600 / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
export async function readFourLineResearch(zip: JSZip, base: Row, root: string): Promise<Row> {
  ensure(base?.trips?.some((t: Row) => t.line_id === 'BEX'), '四线研究导入需要既有滨海快线版本')
  const read = async (name: string) => { const file = zip.file(root + name); ensure(file, `缺少 ${name}`); return (await file!.async('string')).replace(/^\uFEFF/,'') }
  const hashes = new Map((await read('SHA256SUMS.txt')).trim().split(/\r?\n/).map(line => { const match = line.match(/^([a-f0-9]{64})\s+(.+)$/); ensure(match,'校验清单格式无效'); return [match![2],match![1]] }))
  for (const name of ['output/parameters_and_QA.json','output/L1245_full_stops_H0.csv','output/L1245_full_stops_H1.csv','output/L1245_arrivals_H1.csv','output/L1245_departures_H1.csv']) {
    const file = zip.file(root + name); ensure(file && createHash('sha256').update(await file.async('nodebuffer')).digest('hex') === hashes.get(name), `${name} SHA不一致`)
  }
  const qa = JSON.parse(await read('output/parameters_and_QA.json'))
  ensure(qa.version === 'L1245 v1.0' && qa.service_calendar === 'rest_day' && qa.clock_timezone === 'Asia/Shanghai', '未知四线研究版本或日历')
  const parse = async (name: string) => parseCsv(await read(name)) as Record<string,string>[]
  const rows = await parse('output/L1245_full_stops_H1.csv'), old = await parse('output/L1245_full_stops_H0.csv')
  ensure(rows.length === qa.qa_new.stops && old.length === rows.length, '四线H0/H1事件计数不一致')
  const previous = new Map(old.map(r => [`${r.trip_id}/${r.stop_sequence}`,r])), index = new Map<string, Row>(), groups = new Map<string, Row[]>()
  let changedRows = 0
  const changedTrips = new Set<string>()
  for (const row of rows) {
    const key = `${row.trip_id}/${row.stop_sequence}`, baseline = previous.get(key)
    ensure(baseline && !index.has(key) && ['L1','L2','L4','L5'].includes(row.line_id) && row.service_calendar === 'rest_day' && row.train_type === 'local' && row.pass_seconds === '', '四线事件引用/范围/通过状态无效')
    ensure(['line_id','direction_id','station','stop_sequence'].every(field => row[field] === baseline![field]), 'H1改动了事件身份')
    const shift = Number(row.time_shift_seconds)
    ensure(Number.isInteger(shift), '全局平移秒数无效')
    for (const kind of ['arrival','departure']) {
      const value = row[`${kind}_seconds`], original = baseline![`${kind}_seconds`]
      ensure((value === '') === (original === ''), 'H1改变了未知到发字段')
      if (value !== '') ensure(/^\d+$/.test(value) && Number(value) < 172800 && clock(Number(value)) === row[`${kind}_hhmmss`] && Number(value)-Number(original) === shift, '四线时钟或整趟平移不一致')
    }
    if (shift) {
      ensure((row.line_id === 'L1' && row.direction_id === 'to_sanjiangkou' || row.line_id === 'L2' && row.direction_id === 'to_yangli') && row.official_departure_anchor !== '1','H1改动范围越界或改动官方锚点')
      changedRows++; changedTrips.add(row.trip_id)
    }
    index.set(key,row); const group = groups.get(row.trip_id) ?? []; group.push(row); groups.set(row.trip_id,group)
  }
  ensure(groups.size === qa.qa_new.trips && groups.size === 1233, '四线班次数不一致')
  for (const [kind, filename] of [['arrival','arrivals'],['departure','departures']]) {
    const remaining = new Map([...index].filter(([,row]) => row[`${kind}_seconds`] !== ''))
    for (const row of await parse(`output/L1245_${filename}_H1.csv`)) {
      const key = `${row.trip_id}/${row.stop_sequence}`, full = remaining.get(key)
      ensure(full && Object.entries(row).every(([field,value]) => full[field] === value), '四线分表与完整表不一致'); remaining.delete(key)
    }
    ensure(remaining.size === 0,'四线分表事件缺失')
  }
  const trips: Row[] = [], stops: Row[] = []
  for (const [id, values] of groups) {
    const ordered = values.sort((a,b)=>Number(a.stop_sequence)-Number(b.stop_sequence)), first=ordered[0], last=ordered[ordered.length-1]
    ensure(ordered.every((r,i)=>Number(r.stop_sequence)===i+1 && r.line_id===first.line_id && r.direction_id===first.direction_id && r.time_shift_seconds===first.time_shift_seconds),'四线班次序号或整趟偏移不一致')
    trips.push({trip_id:id,line_id:first.line_id,direction_id:first.direction_id,origin:first.station,destination:last.station,train_type:'local',service_calendar:'rest_day',source:'L1245 v1.0 H1研究候选；原来源/冲突见各事件',quality:'research_l1245_v1_0'})
    for (const row of ordered) {
      const station = base.stations[row.line_id]?.find((s:Row)=>s.name===row.station)
      ensure(station,`四线车站无法匹配：${row.station}`)
      stops.push({trip_id:id,line_id:row.line_id,direction_id:row.direction_id,stop_sequence:Number(row.stop_sequence),station_id:station.station_id,station_name:row.station,arrival_time:row.arrival_hhmmss,departure_time:row.departure_hhmmss,time_seconds:Number(row.arrival_seconds || row.departure_seconds),is_stop:true,research_event:row})
    }
  }
  return {...base,generated_date:new Date().toISOString().slice(0,10),trips:[...base.trips.filter((t:Row)=>t.line_id==='BEX'),...trips],stop_times:[...base.stop_times.filter((s:Row)=>s.line_id==='BEX'),...stops],
    source_caveats:{...base.source_caveats,research_l1245_v1_0:{selected:'H1',changedRows,changedTrips:changedTrips.size,qa,caveat:'同日选参回溯拟合，旧基准站时刻存在冲突；未知精度仍为模型，非独立盲测'}}}
}
