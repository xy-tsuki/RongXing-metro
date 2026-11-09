import {describe,it,expect} from 'vitest'
import {hourlyDepartures} from '../src/navigation/hourly-timetable'
describe('hourly departure display',()=>{
  it('sorts by full time, displays only minutes and preserves duplicate-minute trains',()=>{
    const rows=[{tripId:'c',seconds:18*3600+33*60+59},{tripId:'b',seconds:18*3600+27*60+45},{tripId:'a',seconds:18*3600+27*60}]
    const original=JSON.stringify(rows)
    const groups=hourlyDepartures(rows)
    expect(groups.map(g=>g.label)).toEqual(['18'])
    expect(groups[0].departures.map(d=>[d.tripId,d.minute])).toEqual([['a','27'],['b','27'],['c','33']])
    expect(JSON.stringify(rows)).toBe(original)
  })
  it('keeps after-midnight operating hours and known event seconds intact',()=>{
    const groups=hourlyDepartures([{tripId:'b',seconds:24*3600+59},{tripId:'a',seconds:23*3600+59*60+59},{tripId:'c',seconds:25*3600+60}])
    expect(groups.map(g=>[g.label,g.departures[0].minute])).toEqual([['23','59'],['24','00'],['25','01']])
    expect(groups[1].departures[0].seconds).toBe(24*3600+59)
    expect(hourlyDepartures([])).toEqual([])
  })
})
