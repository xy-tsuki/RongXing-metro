import { it, expect } from 'vitest'
import JSZip from 'jszip'
import { createHash } from 'node:crypto'
import { toCsv } from '../scripts/data-csv'
import { readFourLineResearch } from '../scripts/maintenance/research-four-lines'
function fixture(tamper = false) {
  const zip = new JSZip(), root = 'research/', rows = Array.from({length:1233},(_,i)=>[0,1].map(n=>({trip_id:`train-${i}`,line_id:'L1',direction_id:'to_sanjiangkou',stop_sequence:String(n+1),station:n?'秀山':'象峰',train_type:'local',service_calendar:'rest_day',arrival_seconds:n?'21720':'',departure_seconds:n?'':'21600',pass_seconds:'',source_basis:'synthetic',confidence:'synthetic',official_departure_anchor:'0',time_shift_seconds:'0',arrival_hhmmss:n?'06:02:00':'',departure_hhmmss:n?'':'06:00:00',pass_hhmmss:'',variant:'H1_global_peak',precision_label:'model_candidate_not_official',algorithm_reason:'preserve_base_source_timetable'}))).flat()
  const files: Record<string,string> = {'output/parameters_and_QA.json':JSON.stringify({version:'L1245 v1.0',service_calendar:'rest_day',clock_timezone:'Asia/Shanghai',qa_new:{trips:1233,stops:2466}}),'output/L1245_full_stops_H0.csv':toCsv(rows),'output/L1245_full_stops_H1.csv':toCsv(rows)}
  for (const [kind,filename] of [['arrival','arrivals'],['departure','departures']]) files[`output/L1245_${filename}_H1.csv`]=toCsv(rows.filter(r=>(r as any)[`${kind}_seconds`]!=='').map(r=>({trip_id:r.trip_id,line_id:r.line_id,direction_id:r.direction_id,stop_sequence:r.stop_sequence,station:r.station,[`${kind}_seconds`]:(r as any)[`${kind}_seconds`],[`${kind}_hhmmss`]:(r as any)[`${kind}_hhmmss`],train_type:r.train_type,service_calendar:r.service_calendar,precision_label:r.precision_label,algorithm_reason:r.algorithm_reason})))
  for(const [name,text] of Object.entries(files)) zip.file(root+name,text)
  zip.file(root+'SHA256SUMS.txt',Object.entries(files).map(([name,text])=>`${createHash('sha256').update(text).digest('hex')}  ${name}`).join('\n'))
  if(tamper) zip.file(root+'output/L1245_departures_H1.csv','tampered')
  return {zip,root}
}
const base={trips:[{trip_id:'bex-kept',line_id:'BEX'}],stop_times:[{trip_id:'bex-kept',line_id:'BEX',value:'original'}],stations:{L1:[{station_id:'a',name:'象峰'},{station_id:'b',name:'秀山'}]},source_caveats:{research_v1_2:'preserved'}}
it('four-line H1 keeps the existing BEX version and preserves missing arrival/departure values',async()=>{
  const {zip,root}=fixture();const result=await readFourLineResearch(zip,base,root)
  expect(result.trips[0]).toEqual(base.trips[0]); expect(result.stop_times[0]).toEqual(base.stop_times[0])
  expect(result.trips).toHaveLength(1234);expect(result.stop_times[1].arrival_time).toBe('')
  expect(result.stop_times[2].departure_time).toBe('');expect(result.source_caveats.research_v1_2).toBe('preserved')
})
it('four-line package hash mismatch cannot be imported',async()=>{
  const {zip,root}=fixture(true);await expect(readFourLineResearch(zip,base,root)).rejects.toThrow('SHA不一致')
})
