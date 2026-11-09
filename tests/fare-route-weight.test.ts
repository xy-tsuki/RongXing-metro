import { describe, expect, it, vi } from 'vitest'
import { planJourney } from '../src/core'
import type { JourneyRoute } from '../src/core/types'
import { fuzhouDataset } from '../src/data/fuzhou'
import { farePresentation, routeFareLookup } from '../src/navigation/fare-presentation'
import { recommendedDeparture, usefulDepartures } from '../src/navigation/departure-selection'
import { departureWindow } from '../src/navigation/departures'
import { queryTimetable, testTimetable } from '../src/navigation/test-timetable'

const stamp=(value:string)=>`2026-10-17T${value}:00+08:00`
const template=planJourney(fuzhouDataset,{from:'fz-洋里',to:'fz-机场',mode:'shortest'}).routes[0]
const run=(id:string,dep:string,arr:string,price:number|null, extras:Partial<JourneyRoute>={})=>({
  id,routeId:id,routeOverride:{...template,...extras,id},price,
  timing:{route:{source:'timetable' as const,departureAt:stamp(dep),arrivalAt:stamp(arr)}}
})
const prices=(items:ReturnType<typeof run>[]) => (route:JourneyRoute) => items.find(i=>i.routeId===route.id)!.price

describe('fare-aware route comparison',()=>{
  it('removes a more expensive earlier departure that arrives later, even within ten minutes',()=>{
    const a=run('expensive','08:00','09:00',20),b=run('better','08:03','08:59',18),items=[a,b]
    expect(usefulDepartures(items,'shortest',prices(items)).map(x=>x.id)).toEqual(['better'])
    a.timing.route.departureAt=b.timing.route.departureAt;a.timing.route.arrivalAt=b.timing.route.arrivalAt
    expect(usefulDepartures(items,'shortest',prices(items)).map(x=>x.id)).toEqual(['better'])
  })
  it('keeps an expensive route if it departs later or arrives earlier',()=>{
    const later=run('later','08:05','09:00',20), early=run('early','08:00','08:59',18)
    expect(usefulDepartures([later,early],'shortest',prices([later,early]))).toHaveLength(2)
    later.timing.route.departureAt=stamp('08:00');later.timing.route.arrivalAt=stamp('08:58')
    early.timing.route.departureAt=stamp('08:05');early.timing.route.arrivalAt=stamp('08:59')
    expect(usefulDepartures([later,early],'shortest',prices([later,early]))).toHaveLength(2)
  })
  it('protects fewer transfers, substantially less walking, or fewer confirmed stairs',()=>{
    const a=run('expensive','08:00','09:00',20,{transferCount:0,walkingMetres:100,stairCount:0})
    const b=run('cheap','08:05','08:45',18,{transferCount:1,walkingMetres:500,stairCount:20})
    expect(usefulDepartures([a,b],'shortest',prices([a,b]))).toHaveLength(2)
    a.routeOverride.transferCount=1;a.routeOverride.walkingMetres=490
    expect(usefulDepartures([a,b],'few-stairs',prices([a,b]))).toHaveLength(2)
    a.routeOverride.stairCount=20
    expect(usefulDepartures([a,b],'shortest',prices([a,b])).map(x=>x.id)).toEqual(['cheap'])
  })
  it('retains an unknown fare instead of interpreting it as zero or as equal fare',()=>{
    for(const [p,q] of [[null,18],[20,null],[null,null]] as const){
      const a=run('a','08:00','09:00',p),b=run('b','08:05','08:40',q)
      expect(usefulDepartures([a,b],'shortest',prices([a,b]))).toHaveLength(2)
    }
  })
  it('uses a configurable five minutes per yuan to balance a cheaper slow route',()=>{
    const slow=run('slow','08:00','09:00',18),fast=run('fast','08:05','08:48',20)
    expect(usefulDepartures([slow,fast],'shortest',prices([slow,fast]))).toHaveLength(2)
    fast.timing.route.arrivalAt=stamp('08:39')
    expect(usefulDepartures([slow,fast],'shortest',prices([slow,fast])).map(x=>x.id)).toEqual(['fast'])
  })
  it('recommends by arrival plus fare while preserving mode priorities and unknown fares',()=>{
    const cheap=run('cheap','08:00','09:00',18),fast=run('fast','08:05','08:55',20),items=[fast,cheap]
    expect(recommendedDeparture(items,fast,'shortest',prices(items))?.id).toBe('cheap')
    cheap.routeOverride.walkingMetres=200;fast.routeOverride.walkingMetres=100
    expect(recommendedDeparture(items,fast,'shortest',prices(items))?.id).toBe('fast')
    cheap.routeOverride.walkingMetres=null;fast.routeOverride.walkingMetres=null
    cheap.routeOverride.stairCount=4;fast.routeOverride.stairCount=0
    expect(recommendedDeparture(items,cheap,'few-stairs',prices(items))?.id).toBe('fast')
    cheap.routeOverride.stairCount=0;cheap.routeOverride.walkingMetres=200;fast.routeOverride.walkingMetres=100
    expect(recommendedDeparture(items,cheap,'few-stairs',prices(items))?.id).toBe('fast')
    cheap.routeOverride.walkingMetres=100;cheap.routeOverride.stairCount=4
    expect(recommendedDeparture(items,cheap,'shortest',prices(items))?.id).toBe('fast')
    cheap.routeOverride.walkingMetres=null;fast.routeOverride.walkingMetres=null
    fast.price=null
    expect(recommendedDeparture(items,fast,'shortest',prices(items))?.id).toBe('fast')
    fast.price=18;fast.timing.route.arrivalAt=cheap.timing.route.arrivalAt
    expect(recommendedDeparture(items,cheap,'shortest',prices(items))?.id).toBe('cheap')
  })
  it('keeps the known primary mode objective when the next objective is only partially known',()=>{
    const fallback=run('fallback','08:00','09:00',18,{walkingMetres:200,stairCount:0})
    const unknown=run('unknown','08:01','09:00',18,{walkingMetres:100,stairCount:null})
    const known=run('known','08:02','09:00',18,{walkingMetres:100,stairCount:0})
    const items=[fallback,unknown,known]
    expect(recommendedDeparture(items,fallback,'shortest',prices(items))?.id).toBe('unknown')
  })
  it('uses the existing selected-route paid-area calculation for real fare differences',()=>{
    const routes=planJourney(fuzhouDataset,{from:'fz-洋里',to:'fz-机场',mode:'shortest'}).routes
    const priced=routes.map(route=>({route,amount:farePresentation({cityId:fuzhouDataset.city.id,networkVersion:fuzhouDataset.version,from:'fz-洋里',to:'fz-机场',route})?.quote.amount}))
    expect(priced.some(x=>x.amount===20 && x.route.transfers.some(t=>t.kind==='external'))).toBe(true)
    expect(priced.some(x=>x.amount===18 && x.route.transfers.every(t=>t.kind!=='external'))).toBe(true)
  })
  it('applies actual paid-area prices in the timetable query and refuses incompatible network data',()=>{
    const original=template.legs[0]
    const leg=(serviceId:string,fromStationId:string,toStationId:string)=>({...original,serviceId,fromStationId,toStationId})
    const out={stationId:'fz-水部',stationName:'水部',fromLineName:'2号线',toLineName:'滨海快线',kind:'external' as const,fromStationId:'fz-水部',toStationId:'fz-闽都',path:null,instructions:[]}
    const expensive={...template,id:'expensive',legs:[leg('x1','fz-洋里','fz-水部'),leg('x2','fz-闽都','fz-机场')],transfers:[out],transferCount:1}
    const cheap={...template,id:'cheap',legs:[leg('x3','fz-洋里','fz-机场')],transfers:[],transferCount:0}
    const trip=(id:string,serviceId:string,from:string,to:string,start:number,end:number)=>({id,lineId:'test',serviceId,type:'local',calendar:'all_days' as const,quality:'synthetic',stops:[[from,start],[to,end]] as [string,number][]})
    const bundle={...testTimetable,trips:[trip('t1','x1','fz-洋里','fz-水部',28800,29400),trip('t2','x2','fz-闽都','fz-机场',30000,32400),trip('t3','x3','fz-洋里','fz-机场',29100,32340)]}
    const window=departureWindow(stamp('08:00'))
    expect(routeFareLookup(fuzhouDataset)(expensive)).toBe(20)
    expect(routeFareLookup(fuzhouDataset)(cheap)).toBe(18)
    expect(queryTimetable([expensive,cheap],window,bundle,fuzhouDataset).departures.map(x=>x.routeId)).toEqual(['cheap'])
    const incompatible={...fuzhouDataset,version:'different-network'}
    expect(queryTimetable([expensive,cheap],window,bundle,incompatible).departures.map(x=>x.routeId)).toEqual(['expensive','cheap'])
  })
  it('uses fare weighting for the selected candidate in the shared real-network session',async()=>{
    vi.stubGlobal('uni',{getStorageSync:()=>undefined})
    try {
      const {useJourneySession}=await import('../src/navigation/session')
      const session=useJourneySession()
      session.useDataset('real'); session.from.value='fz-洋里';session.to.value='fz-机场'
      session.setDeparture({kind:'scheduled',departureAt:stamp('08:00')})
      const items=session.candidates.value
      expect(items.length).toBeGreaterThan(1)
      const lookup=routeFareLookup(session.data)
      expect(items.every(item=>item.routeOverride && lookup(item.routeOverride)!>0)).toBe(true)
      const best=Math.min(...items.map(item=>Date.parse(item.timing.route!.arrivalAt!)+lookup(item.routeOverride!)!*5*60_000))
      const selected=items.find(item=>item.id===session.selectedDeparture.value)!
      expect(Date.parse(selected.timing.route!.arrivalAt!)+lookup(selected.routeOverride!)!*5*60_000).toBe(best)
    } finally { vi.unstubAllGlobals() }
  })
})
