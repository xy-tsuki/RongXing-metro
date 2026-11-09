import { describe, expect, it, vi } from 'vitest'
import { planJourney } from '../src/core'
import { demoDataset } from '../src/data/demo'
import { candidateGeometry, columnMetrics, demoDepartures, departureWindow, diagonalDrag, displayCandidates, inDepartureWindow } from '../src/navigation/departures'
import type { DepartureCandidate } from '../src/navigation/departures'
import { BOARD_FOOTER, fitBoardCamera, protectedColumns, quarterHourTicks, snapBoardX } from '../src/navigation/board-camera'
const window = departureWindow('2026-10-17T23:54:00+08:00')
const routes = () => planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes
const at = (offset: number) => new Date(Date.parse(window.startAt) + offset * 60_000).toISOString()
const run = (id: string, offset: number, duration: number, routeId = 'path') => ({ id, routeId, timing: { route: { source: 'timetable' as const, departureAt: at(offset), arrivalAt: at(offset + duration) } } })

describe('departure instances and shared time geometry', () => {
  it('filters the half-open 30-minute departure window across midnight; preserves repeated paths', () => {
    const items = [run('late',30,16),run('second',29,16),run('before',-1,25),run('first',0,25)]
    expect(inDepartureWindow(items, window).map(item => item.id)).toEqual(['first','second'])
    expect(window.endAt).toBe('2026-10-17T16:24:00.000Z')
    const overlap = departureWindow('2026-10-17T23:55:00+08:00')
    const original = demoDepartures(routes(), window).map(item => item.id)
    expect(demoDepartures(routes(), overlap).filter(item=>Date.parse(item.timing.route!.departureAt!)<Date.parse(window.endAt)).every(item=>original.includes(item.id))).toBe(true)
  })
  it('does not turn missing clocks, durations, or invalid runs into timetable data', () => {
    const missing: DepartureCandidate = { id: 'unknown', routeId:'path', timing:{route:{source:'estimate',durationMinutes:16}} }
    const ambiguous = run('ambiguous',0,16); ambiguous.timing.route.departureAt = '2026-10-17T23:54:00'
    expect(inDepartureWindow([missing,ambiguous,run('reversed',0,-2)],window)).toEqual([])
    expect(displayCandidates(routes(),[],window,false)).toHaveLength(routes().length)
    expect(displayCandidates(routes(),[],window,true)).toEqual([]) // Confirmed empty timetable != missing provider.
  })
  it('places departures, durations and arrivals on one linear time scale', () => {
    const route = routes()[0]
    const display = (id: string, offset: number, duration: number) => ({ ...run(id,offset,duration,route.id), route, routeIndex:0 })
    const short = candidateGeometry(display('short',4,16),window,true)
    const long = candidateGeometry(display('long',2,25),window,true)
    expect(short.height / long.height).toBe(16/25)
    expect(short.top-long.top).toBe(24)
    expect(short.top+short.height).toBeLessThan(long.top+long.height)
  })
  it.each([288,328,358,398])('fits exactly four complete columns plus a partial fifth in %ipx', width => {
    const column = columnMetrics(width)
    expect(column.inset+3*column.stride+column.width).toBeLessThan(width)
    expect(column.inset+4*column.stride).toBeLessThan(width)
    expect(column.inset+4*column.stride+column.width).toBeGreaterThan(width)
  })
  it('follows a fifteen-degree slope during a swipe, including reverse and bounds', () => {
    const forward = diagonalDrag(100,20,-45,500), reverse = diagonalDrag(100,20,45,500)
    expect(forward.x).toBe(145); expect(forward.y).toBeCloseTo(32.05771366)
    expect(reverse.x).toBe(55); expect(reverse.y).toBeCloseTo(7.94228634)
    const bounded = diagonalDrag(100,20,-900,500)
    expect(bounded.x).toBe(500); expect(bounded.y).toBeCloseTo(127.17967697)
    expect(Math.atan((forward.y-20)/(forward.x-100))*180/Math.PI).toBeCloseTo(15)
    expect(diagonalDrag(0,0,40,500)).toEqual({x:0,y:0})
  })
  it('automatically fits complete columns while preserving the initial query-time origin', () => {
    const metrics = columnMetrics(358)
    const shapes = [7,9,17,19,27,29].map((offset,index)=>({top:68+offset*12,height:(index%2?25:16)*12}))
    const frame = fitBoardCamera({x:0,viewportWidth:358,viewportHeight:540,stride:metrics.stride,columnWidth:metrics.width,inset:8,shapes,timed:true})
    expect(frame.y).toBe(0)
    expect(frame.scale).toBeLessThan(1)
    for (const shape of shapes.slice(0,3)) expect(68+(shape.top-68+shape.height)*frame.scale-frame.y+BOARD_FOOTER).toBeLessThanOrEqual(540.000001)
    const later = fitBoardCamera({x:metrics.stride,viewportWidth:358,viewportHeight:540,stride:metrics.stride,columnWidth:metrics.width,inset:8,shapes,timed:true})
    expect(later.y).toBeGreaterThan(0)
    for (const shape of shapes.slice(2,5)) {
      expect(68+(shape.top-68)*later.scale-later.y-50).toBeGreaterThanOrEqual(17.999999)
      expect(68+(shape.top-68+shape.height)*later.scale-later.y+BOARD_FOOTER).toBeLessThanOrEqual(540.000001)
    }
    expect(fitBoardCamera({x:0,viewportWidth:358,viewportHeight:540,stride:metrics.stride,columnWidth:metrics.width,inset:8,shapes:[{top:68,height:220}],timed:false})).toEqual({x:0,y:0,scale:1})
    const untimed = fitBoardCamera({x:0,viewportWidth:358,viewportHeight:400,stride:metrics.stride,columnWidth:metrics.width,inset:8,shapes:[{top:68,height:355}],timed:false})
    expect(untimed.y).toBe(0)
    expect(68+355*untimed.scale+BOARD_FOOTER).toBeLessThanOrEqual(400.000001)
  })
  it('protects three columns at the start, middle and end while allowing the fourth to overflow', () => {
    const input = {viewportWidth:358, viewportHeight:540, stride:78, columnWidth:72, inset:8, timed:true,
      shapes: [0, 1, 2, 60, 61, 62, 63].map(offset => ({top:68+offset*12,height:25*12}))}
    expect(protectedColumns({...input,x:0,count:7})).toEqual([0,1,2])
    expect(protectedColumns({...input,x:78,count:7})).toEqual([2,3,4])
    const endX = 8 + 6*78 + 72 - 358
    expect(protectedColumns({...input,x:endX,count:7})).toEqual([4,5,6])
    for (const x of [0,23,78,120,endX]) {
      const frame = fitBoardCamera({...input,x,preferredY: x * Math.tan(Math.PI/12)})
      for (const i of protectedColumns({...input,x,count:7})) {
        const shape = input.shapes[i]
        expect(68+(shape.top-68)*frame.scale-frame.y-50).toBeGreaterThanOrEqual(17.99999)
        expect(68+(shape.top-68+shape.height)*frame.scale-frame.y+BOARD_FOOTER).toBeLessThanOrEqual(540.00001)
      }
    }
    const frame = fitBoardCamera({...input,x:0})
    expect(68+(input.shapes[3].top-68+input.shapes[3].height)*frame.scale+BOARD_FOOTER).toBeGreaterThan(540)
  })
  it('keeps a short final range reachable when there are only four candidates', () => {
    expect(snapBoardX(0,16,75)).toBe(0)
    expect(snapBoardX(16,16,75)).toBe(16)
    expect(snapBoardX(1150,1175,75)).toBe(1175)
    expect(snapBoardX(155,1175,75)).toBe(150)
  })
  it('aligns gray ticks to real quarter hours across midnight, never to the query minute', () => {
    const ticks = quarterHourTicks('2026-10-17T23:54:00+08:00', '2026-10-18T00:31:00+08:00')
    expect(ticks.map(tick => tick.minutes)).toEqual([-9,6,21,36])
    for (const tick of ticks) expect(new Date(tick.at).getUTCMinutes()%15).toBe(0)
    for (const scale of [.2,.75,1]) expect((ticks[2].minutes-ticks[1].minutes)*12*scale).toBeCloseTo(15*12*scale)
  })
  it('keeps synthetic repeated departures isolated, and supplies consistent per-leg clocks', () => {
    const paths = routes(), runs = demoDepartures(paths,window)
    expect(runs.length).toBeGreaterThanOrEqual(6)
    expect(new Set(runs.filter(item => item.routeId===paths[0].id).map(item => item.id)).size).toBe(3)
    expect(demoDepartures(paths.map(route => ({...route,confidence:'topology-only' as const})),window)).toEqual([])
    for (const item of runs) {
      const path = paths.find(route => route.id===item.routeId)!
      expect(item.timing.route!.source).toBe('demo')
      expect(item.timing.legs![0].departureAt).toBe(item.timing.route!.departureAt)
      expect(item.timing.legs![path.legs.length-1].arrivalAt).toBe(item.timing.route!.arrivalAt)
      path.transfers.forEach((_,index) => expect(Date.parse(item.timing.legs![index+1].departureAt!)).toBeGreaterThan(Date.parse(item.timing.legs![index].arrivalAt!)))
    }
    const incomplete = structuredClone(paths[0]); incomplete.doorCombinations=[]; incomplete.transfers[0].path=null
    expect(demoDepartures([incomplete],window)).toEqual([])
  })
  it('keeps the chosen departure timing and board position when entering and returning from details', async () => {
    vi.stubGlobal('uni',{getStorageSync:()=>undefined})
    const {useJourneySession} = await import('../src/navigation/session')
    const session=useJourneySession(); session.useDataset('demo')
    session.setDeparture({kind:'scheduled',departureAt:window.startAt})
    const subsequent=session.candidates.value.find(item => item.routeIndex===0 && item.id!==session.candidates.value[0].id)!
    session.selectDeparture(subsequent.id); session.boardPosition.value={x:170,y:120}
    expect(useJourneySession().routeTiming.value?.route?.departureAt).toBe(subsequent.timing.route?.departureAt)
    expect(useJourneySession().boardPosition.value).toEqual({x:170,y:120})
    session.changeMode('elevator')
    expect(session.boardPosition.value).toEqual({x:0,y:0})
    expect(session.selectedDeparture.value).toBe(session.candidates.value[0].id)
    session.useDataset('real');session.setDeparture({kind:'scheduled',departureAt:'2026-10-17T08:00:00+08:00'});session.calculate()
    expect(session.timetableAvailable.value).toBe(true)
    expect(session.routeTiming.value?.route?.departureAt).toBeDefined()
    vi.unstubAllGlobals()
  })
})
