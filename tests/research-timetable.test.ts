import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { toCsv } from '../scripts/data-csv'
import { readResearchTimetable } from '../scripts/maintenance/research-timetable'
const base = { trips: [{ trip_id: 'kept', line_id: 'L1' }, { trip_id: 'old', line_id: 'BEX' }], stop_times: [{ trip_id: 'kept', line_id: 'L1', value: 'unchanged' }], stations: { BEX: [{ station_id: 'a', name: '福州火车站', order: 1 }, { station_id: 'b', name: '东门', order: 2 }] }, source_caveats: { BEX: 'old', L1: 'kept' } }
const clock = (s: number) => `${String(Math.floor(s / 3600)).padStart(2,'0')}:${String(s % 3600 / 60).padStart(2,'0')}:00`
function fixture(bad = false) {
  const rows = Array.from({length:298}, (_, i) => [0,1].map(n => ({ trip_id: `new-${i}`, line_id: 'BEX', direction: 'to_wenling', train_type: 'local', calendar: 'all_days', stop_seq: String(n+1), station: n ? '东门' : '福州火车站', arrival_s: n ? String(25320+i*60) : '', departure_s: n ? '' : String(25200+i*60), pass_s: '', arrival_clock: n ? clock(25320+i*60) : '', departure_clock: n ? '' : clock(25200+i*60), pass_clock: '', confidence: 'modeled_candidate', source_kind: 'global_8slot_research_model', version:'v1.2' }))).flat()
  const zip = new JSZip()
  zip.file('results/manifest_v1.2.json', JSON.stringify({version:'F1_to_wenling_v1.2',database_count:{trips:298,stop_events:596,arrivals:298,departures:298,passes:0}}))
  zip.file('results/F1_v1.2_all_stop_events.csv', toCsv(rows))
  for (const [kind, file] of [['arrival','arrivals'],['departure','departures'],['pass','passes']]) {
    const subset = rows.filter(row => (row as any)[`${kind}_s`] !== '').map(row => ({trip_id:row.trip_id, direction:row.direction,train_type:row.train_type,station:row.station,stop_seq:row.stop_seq,time_seconds:(row as any)[`${kind}_s`],time:(row as any)[`${kind}_clock`],quality:row.confidence,source:row.source_kind}))
    if (bad && kind === 'departure') subset[0].time_seconds = '999'
    zip.file(`results/F1_v1.2_${file}.csv`, subset.length ? toCsv(subset) : 'trip_id,direction,train_type,station,stop_seq,time_seconds,time,quality,source\n')
  }
  zip.file('outputs/F1_all_stop_events_v1.2.csv','ignored obsolete variant')
  return zip
}
describe('explicit results research replacement', () => {
  it('selects results only, replaces all BEX and preserves other lines and source fields', async () => {
    const result = await readResearchTimetable(fixture(), base)
    expect(result.trips.filter((t: any) => t.line_id==='BEX')).toHaveLength(298)
    expect(result.trips[0]).toEqual(base.trips[0])
    expect(result.stop_times[0]).toEqual(base.stop_times[0])
    expect(result.stop_times[1].arrival_time).toBe('')
    expect(result.stop_times[1].departure_time).toBe('07:00:00')
    expect(result.stop_times[1].research_event.confidence).toBe('modeled_candidate')
    expect(result.source_caveats.previous_BEX_caveats).toEqual({ BEX:'old' })
  })
  it('rejects mismatched split events and refuses a missing base', async () => {
    await expect(readResearchTimetable(fixture(true),base)).rejects.toThrow('分表')
    await expect(readResearchTimetable(fixture(),undefined as any)).rejects.toThrow('基线')
  })
})
