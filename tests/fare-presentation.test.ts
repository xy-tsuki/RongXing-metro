import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import projection from '../src/navigation/fare-display-data.json'
import database from '../src/data/fuzhou-fares.json'
import network from '../src/data/fuzhou-network.json'
import type { JourneyLeg, JourneyRoute, TransferGuide } from '../src/core/types'
import { farePresentation } from '../src/navigation/fare-presentation'
import { getStationFare } from '../src/core/fare'

const leg = (from: string, to: string): JourneyLeg => ({serviceId:'test',lineId:'test',lineName:'测试线路',lineColor:'#176b52',direction:'终点',fromStationId:from,fromStationName:'起点',toStationId:to,toStationName:'终点',stopCount:1,rideMinutes:1,recommendations:[],recommendationStatus:'pending',recommendationBasis:[]})
const walk = (from: string, to: string): TransferGuide => ({stationId:from,stationName:'站外衔接',fromStationId:from,toStationId:to,fromLineName:'来源',toLineName:'目标',kind:'external',path:null,instructions:[]})
function route(from: string, to: string, values: Partial<JourneyRoute> = {}): JourneyRoute {
  return {id:'test',legs:[leg(from,to)],transfers:[],originPath:null,destinationPath:null,walkingMetres:null,stairCount:null,rideMinutes:1,totalMinutes:null,transferCount:0,confidence:'topology-only',equalChoicesTruncated:false,granularity:'basic',...values}
}
const input = (from: string, to: string, selected = route(from,to)) => ({cityId:'fuzhou',networkVersion:network.version,from,to,route:selected})
describe('fare UI integration', () => {
  it('checks every projected pair against the sole source, plus network identity and source hash', () => {
    expect(projection.sourceSha256).toBe(createHash('sha256').update(readFileSync('src/data/fuzhou-fares.json')).digest('hex'))
    expect(projection.sourceNetworkVersion).toBe(network.version)
    expect(projection.stations).toEqual(network.stations.map(s=>s.id).sort())
    expect(projection.quotes).toHaveLength(database.pairs.length)
    database.pairs.forEach((pair,index)=>expect(projection.quotes[index]).toEqual([projection.stations.indexOf(pair.stationIdA),projection.stations.indexOf(pair.stationIdB),pair.fareYuan,pair.mainAreaFareYuan,pair.newDistrictFareYuan]))
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThan(100_000)
  })
  it('shows the entry-exit fare in both directions independent of in-station ride choices', () => {
    expect(farePresentation(input('fz-福州火车站','fz-机场'))?.quote.amount).toBe(17)
    expect(farePresentation(input('fz-机场','fz-福州火车站'))?.quote.amount).toBe(17)
    const alternate=route('fz-福州火车站','fz-机场',{legs:[leg('fz-福州火车站','fz-帝封江'),leg('fz-帝封江','fz-机场')]})
    expect(farePresentation(input('fz-福州火车站','fz-机场',alternate))?.quote.amount).toBe(17)
  })
  it('splits an out-of-station transfer and exposes both charged segments', () => {
    const selected=route('fz-南门兜','fz-机场',{legs:[leg('fz-南门兜','fz-水部'),leg('fz-闽都','fz-机场')],transfers:[walk('fz-水部','fz-闽都')],transferCount:1})
    const value=farePresentation(input('fz-南门兜','fz-机场',selected))!
    expect(value.segments).toHaveLength(2)
    expect(value.quote.amount).toBe(getStationFare('fz-南门兜','fz-水部')!.fareYuan+getStationFare('fz-闽都','fz-机场')!.fareYuan)
    expect(value.segments[0].toStationId).toBe('fz-水部')
    expect(value.segments[1].fromStationId).toBe('fz-闽都')
  })
  it('does not charge for access/egress or walking-only connections', () => {
    const selected=route('fz-闽都','fz-机场',{accessTransfers:[walk('fz-水部','fz-闽都')]})
    expect(farePresentation(input('fz-水部','fz-机场',selected))?.quote.amount).toBe(getStationFare('fz-闽都','fz-机场')!.fareYuan)
    expect(farePresentation(input('fz-水部','fz-闽都',route('fz-水部','fz-闽都',{legs:[],accessTransfers:[walk('fz-水部','fz-闽都')]})))).toBeNull()
  })
  it('shows two yuan for explicit same-station entry/exit', () => {
    expect(farePresentation({cityId:'fuzhou',from:'fz-机场',to:'fz-机场'})?.quote.amount).toBe(2)
  })
  it('hides demo, unknown cities, stale networks and missing segment prices', () => {
    const valid=input('fz-福州火车站','fz-机场')
    for(const change of [{demo:true},{cityId:'other'},{networkVersion:'changed'},{to:'unknown'}]) expect(farePresentation({...valid,...change})).toBeNull()
    expect(farePresentation({...valid,route:route('unknown','fz-机场')})).toBeNull()
    expect(farePresentation({...valid,route:route(valid.from,valid.to,{transfers:[{...walk(valid.from,'fz-闽都'),toStationId:undefined}]})})).toBeNull()
  })
})
