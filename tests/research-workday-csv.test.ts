import { describe,it,expect } from 'vitest'
import network from '../src/data/fuzhou-network.json'
import { toCsv } from '../scripts/data-csv'
import { prepareTimetable } from '../scripts/maintenance/timetable-import'
import type { MetroDataset } from '../src/core/types'

function fixture(tamper='') {
  const base:any={schema_version:'0.2',lines:[],stations:{},trips:[],stop_times:[],source_caveats:{retained:true}}, rows:any[]=[]
  for(const line of ['L1','L2','L4','L5','L6','BEX']) {
    const canonical=line==='BEX'?'fz-f1':`fz-${line.toLowerCase()}`, services=network.services.filter(s=>s.lineId===canonical), daily=['L6','BEX'].includes(line)
    base.lines.push({line_id:line,name:network.lines.find(l=>l.id===canonical)!.name})
    base.stations[line]=services[0].stops.map((s,i)=>({station_id:`${line}:${s.stationId}`,name:network.stations.find(v=>v.id===s.stationId)!.name.replace('三叉街（滨海快线）','三叉街'),order:i+1}))
    for(const service of services) {
      const id=`synthetic-${service.id}`
      if(daily)base.trips.push({trip_id:id,line_id:line,direction_id:service.id,origin:base.stations[line].find((s:any)=>s.station_id.endsWith(service.stops[0].stationId)).name,destination:base.stations[line].find((s:any)=>s.station_id.endsWith(service.stops.at(-1)!.stationId)).name,train_type:'local',service_calendar:'all_days',source:'synthetic',quality:'retained'})
      for(const [i,stop] of service.stops.entries()) {
        const station=base.stations[line].find((s:any)=>s.station_id===`${line}:${stop.stationId}`),n=21600+i*120,last=i===service.stops.length-1
        const row={trip_id:id,line_id:line,calendar:daily?'all_days':'workday',direction:service.id,train_type:'local',stop_sequence:String(i+1),station:station.name,arrival_seconds:i?String(n):'',departure_seconds:last?'':String(n),pass_seconds:'',model_version:daily?'v1.1_untouched':'v2.0_two_parameter_smooth_phase_RESEARCH',evidence_status:'synthetic',phase_robustness_shift_seconds:'0'}
        rows.push(row)
        if(daily)base.stop_times.push({trip_id:id,line_id:line,direction_id:service.id,stop_sequence:i+1,station_id:station.station_id,station_name:row.station,arrival_time:i?new Date(n*1000).toISOString().slice(11,19):'',departure_time:last?'':new Date(n*1000).toISOString().slice(11,19),time_seconds:n,is_stop:true})
      }
    }
  }
  // A separate old weekday identity is replaced; its old source remains in the DB history.
  base.trips.push({...base.trips[0],trip_id:'old-weekday',line_id:'L1',service_calendar:'workday'})
  if(tamper==='daily')rows.find(r=>r.line_id==='L6').departure_seconds='22000'
  if(tamper==='duplicate')rows.push({...rows[0]})
  if(tamper==='calendar')rows[0].calendar='rest_day'
  if(tamper==='sequence')rows[0].stop_sequence='0'
  if(tamper==='time')rows[1].arrival_seconds='1'
  if(tamper==='station')rows[0].station='unknown'
  if(tamper==='fraction')rows[0].departure_seconds='21600.5'
  return {base,raw:Buffer.from(toCsv(rows))}
}
describe('standalone workday v2 CSV',()=>{
  it('replaces only weekdays, preserves daily JSON and uses the normal validator',async()=>{
    const {base,raw}=fixture(),p=await prepareTimetable(raw,network as MetroDataset,base)
    expect(p.report.importFormat).toBe('research-workday-csv-v2.0')
    expect(p.report.sourceFileName).toBe('source.csv')
    expect(p.source.trips.some((t:any)=>t.trip_id==='old-weekday')).toBe(false)
    expect(p.source.trips.filter((t:any)=>t.service_calendar==='all_days')).toEqual(base.trips.filter((t:any)=>t.service_calendar==='all_days'))
    expect(p.source.trips.filter((t:any)=>t.service_calendar==='workday')).toHaveLength(8)
    expect(p.source.stop_times[0]).toEqual(base.stop_times[0])
  })
  it.each(['daily','duplicate','calendar','sequence','time','station','fraction'])('rejects %s before a write',async t=>{
    const {base,raw}=fixture(t);await expect(prepareTimetable(raw,network as MetroDataset,base)).rejects.toThrow()
  })
})
