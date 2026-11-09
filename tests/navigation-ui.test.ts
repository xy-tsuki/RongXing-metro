import { describe, expect, it, vi } from 'vitest'
import { arrivalDayLabel, clockText, estimatedJourneyTiming, validMinutes } from '../src/navigation/timing'
import { planJourney } from '../src/core'
import { demoDataset } from '../src/data/demo'

describe('optional navigation timing presentation',()=>{
  it('does not manufacture clocks or durations for the untimed network',()=>{
    const route=planJourney(demoDataset,{from:'s-west',to:'s-river',mode:'shortest'}).routes[0]
    route.totalMinutes=null;route.legs[0].rideMinutes=null
    const timing=estimatedJourneyTiming(route)
    expect(timing.route?.departureAt).toBeUndefined()
    expect(timing.route?.arrivalAt).toBeUndefined()
    expect(timing.route?.durationMinutes).toBeUndefined()
    expect(timing.legs?.[0].durationMinutes).toBeUndefined()
    expect(timing.route?.source).toBe('demo')
  })
  it('formats offset-aware clocks in the city timezone and marks overnight arrival',()=>{
    expect(clockText('2026-10-17T00:30:00+09:00')).toBe('23:30')
    expect(clockText('2026-10-17T00:30:00+08:00')).toBe('00:30')
    expect(arrivalDayLabel('2026-10-16T23:30:00+08:00','2026-10-17T00:30:00+08:00')).toBe('次日')
    expect(arrivalDayLabel('2026-10-16T23:30:00+08:00','2026-10-16T23:50:00+08:00')).toBe('')
  })
  it('rejects ambiguous or invalid clock inputs and negative durations',()=>{
    expect(clockText('2026-10-17T10:00:00')).toBeNull()
    expect(clockText('nonsense')).toBeNull()
    expect(clockText(undefined)).toBeNull()
    expect(validMinutes(-1)).toBeNull()
    expect(validMinutes(NaN)).toBeNull()
    expect(validMinutes(undefined)).toBeNull()
    expect(validMinutes(2.1)).toBe(3)
  })
})

describe('shared three-page navigation state',()=>{
  it('retains query, selected plan, combination and expanded details between page instances',async()=>{
    vi.stubGlobal('uni',{getStorageSync:()=>undefined})
    const {useJourneySession}=await import('../src/navigation/session')
    const search=useJourneySession()
    search.useDataset('demo');search.calculate()
    search.selectedRoute.value=1;search.selectedCombination.value=1
    search.combinationChosen.value=true;search.detailExpanded.value=['transfer-0'];search.detailScrollTop.value=250
    const secondPage=useJourneySession()
    expect(secondPage).toBe(search)
    expect(secondPage.from.value).toBe('s-west')
    expect(secondPage.selectedRoute.value).toBe(1)
    expect(secondPage.selectedCombination.value).toBe(1)
    expect(secondPage.detailExpanded.value).toEqual(['transfer-0'])
    expect(secondPage.detailScrollTop.value).toBe(250)
    secondPage.changeMode('elevator')
    expect(secondPage.selectedRoute.value).toBe(0)
    expect(secondPage.combinationChosen.value).toBe(false)
    expect(secondPage.detailExpanded.value).toEqual([])
    expect(secondPage.route.value?.legs[0].recommendations[0].car).toBe(2)
    vi.unstubAllGlobals()
  })
  it('uses the next feasible half-hour in the actual session and passes mode allowances to every timed transfer', async()=>{
    vi.stubGlobal('uni',{getStorageSync:()=>undefined})
    try {
      const {useJourneySession}=await import('../src/navigation/session')
      const session=useJourneySession()
      session.useDataset('real')
      session.from.value='fz-象峰';session.to.value='fz-机场'
      session.setDeparture({kind:'scheduled',departureAt:'2026-10-17T01:00:00+08:00'})
      expect(session.candidates.value.length).toBeGreaterThan(0)
      expect(Date.parse(session.queryWindow.value.startAt)).toBeGreaterThan(Date.parse('2026-10-17T05:00:00+08:00'))
      expect(session.departureIntent.value.departureAt).toBe('2026-10-17T01:00:00+08:00')
      for(const item of session.candidates.value){
        expect(Date.parse(item.timing.route!.departureAt!)).toBeGreaterThanOrEqual(Date.parse(session.queryWindow.value.startAt))
        expect(Date.parse(item.timing.route!.departureAt!)).toBeLessThan(Date.parse(session.queryWindow.value.endAt))
      }
      session.from.value='fz-南门兜'
      session.setDeparture({kind:'scheduled',departureAt:'2026-10-17T08:00:00+08:00'})
      for(const [mode,indoor,external] of [['shortest',3,10],['few-stairs',5,13],['elevator',7,15]] as const){
        session.changeMode(mode)
        expect(session.candidates.value.length).toBeGreaterThan(0)
        expect(session.candidates.value.some(item=>Object.keys(item.timing.transfers??{}).length>0)).toBe(true)
        for(const item of session.candidates.value) for(const [index,value] of Object.entries(item.timing.transfers??{})){
          const allowance=item.route.transfers[Number(index)].kind==='external'?external:indoor
          expect(value).toMatchObject({testAllowanceMinutes:allowance})
          expect(Date.parse(value.arrivalAt!)-Date.parse(value.departureAt!)).toBeLessThanOrEqual(60*60_000)
        }
      }
    } finally { vi.unstubAllGlobals() }
  })
})
