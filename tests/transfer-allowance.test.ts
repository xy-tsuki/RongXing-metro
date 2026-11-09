import { describe, expect, it } from 'vitest'
import type { TransferGuide, WalkPath } from '../src/core/types'
import { fuzhouDataset } from '../src/data/fuzhou'
import { transferTimePresentation } from '../src/components/transfer-time'
import { transferAllowance } from '../src/navigation/transfer-allowance'

const guide = (fromStationId: string, toStationId: string): TransferGuide => ({ kind: 'external', stationId: fromStationId, stationName: '站外换乘', fromStationId, toStationId, fromLineName: '甲线', toLineName: '乙线', path: null, instructions: [] })
describe('user-set external transfer allowance', () => {
  it.each([
    ['fz-闽都', 'fz-水部'], ['fz-水部', 'fz-闽都'],
    ['fz-三叉街', 'fz-三叉街-滨海快线'], ['fz-三叉街-滨海快线', 'fz-三叉街'],
  ])('both display and allowance use ten minutes in shortest mode for %s → %s without mutating the guide', (from, to) => {
    const transfer = guide(from, to), before = JSON.stringify(transfer)
    expect(transferAllowance(transfer)).toEqual({ minutes: 10, preset: true })
    expect(transferTimePresentation(transfer)).toMatchObject({ minutes: 10, preset: true, label: '换乘约' })
    expect(JSON.stringify(transfer)).toBe(before)
  })
  it('uses connection kind rather than special names or hardcoded station pairs', () => {
    expect(transferAllowance(guide('other', 'city'))).toEqual({ minutes: 10, preset: true })
    expect(transferAllowance({ ...guide('fz-水部', 'fz-闽都'), kind: 'in-station' })).toEqual({ minutes: 3, preset: true })
    expect(transferAllowance(guide('水部', '闽都'))).toEqual({ minutes: 10, preset: true })
  })
  it.each([['shortest',3,10],['few-stairs',5,13],['elevator',7,15]] as const)('shares %s presets with the presentation and preserves measured data', (mode, indoor, external) => {
    const outside=guide('a','b'), inside={...outside,kind:'in-station' as const}
    for(const [g,minutes] of [[inside,indoor],[outside,external]] as const){
      expect(transferAllowance(g,null,undefined,mode)).toEqual({minutes,preset:true})
      expect(transferTimePresentation(g,null,undefined,undefined,mode)).toMatchObject({minutes,preset:true})
      const path:WalkPath={minutes:2,metres:60,nodes:[],edges:[],stairCount:0,instructions:[]}
      expect(transferAllowance(g,path,undefined,mode)).toEqual({minutes:2,preset:false})
    }
  })
  it('keeps known path values, including zero, ahead of the preset', () => {
    const path: WalkPath = { minutes: 0, metres: 0, nodes: [], edges: [], stairCount: 0, instructions: [] }
    const transfer = guide('fz-水部', 'fz-闽都')
    expect(transferAllowance(transfer, path)).toEqual({ minutes: 0, preset: false })
    expect(transferTimePresentation(transfer, path)).toMatchObject({ minutes: 0, preset: false })
    expect(transferTimePresentation(transfer, null, { source: 'timetable', durationMinutes: 12 })).toMatchObject({ minutes: 12, preset: false })
  })
  it('uses recorded external time in both directions while leaving the real snapshot unknown', () => {
    const before = JSON.stringify(fuzhouDataset.externalTransfers)
    const dataset = { ...fuzhouDataset, externalTransfers: fuzhouDataset.externalTransfers!.map(link => ({ ...link, minutes: 11 })) }
    const transfer = guide('fz-闽都', 'fz-水部')
    expect(transferAllowance(transfer, null, dataset)).toEqual({ minutes: 11, preset: false })
    expect(transferTimePresentation(transfer, null, undefined, dataset)).toMatchObject({ minutes: 11, preset: false })
    expect(JSON.stringify(fuzhouDataset.externalTransfers)).toBe(before)
    expect(fuzhouDataset.externalTransfers!.every(link => link.minutes === null)).toBe(true)
  })
})
