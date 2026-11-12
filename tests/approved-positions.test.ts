import { describe, expect, it } from 'vitest'
import network from '../src/data/fuzhou-network.json'
import type { JourneyRoute, MetroDataset } from '../src/core/types'
import { applyApprovedPositions } from '../src/core/approved-positions'
import { createCatalog, rowKey } from '../src/maintenance/catalog'
import { projectApprovedPositions } from '../scripts/maintenance/approved-positions'
import { planJourney } from '../src/core/planner'
import { validateDataset } from '../src/core/validation'
import { recommendationFacilities, positionChoices } from '../src/components/route-presentation'

function fixture() {
  const state = createCatalog(structuredClone(network) as MetroDataset)
  state.revision = 2
  state.rows[rowKey('fz-前屿', 'fz-l2-forward')].电梯对应车厢车门 = '4:8;3:2'
  state.rows[rowKey('fz-前屿', 'fz-l2-reverse')].电梯对应车厢车门 = '4:7;3:1'
  return state
}
describe('transfer guidance after reviewed positions replace a leg', () => {
  // 两段行程：换乘只记录「下车门 → 下一程站台」，不得残留被替换前的旧车门
  const leg = (serviceId: string, toStationId: string, direction: string) => ({ serviceId, lineId: serviceId, lineName: serviceId, lineColor: '#000', direction, fromStationId: 'a', fromStationName: 'a', toStationId, toStationName: toStationId, stopCount: 1, rideMinutes: 2, recommendations: [{ car: 2, door: 3, positionId: 'old' }], recommendationStatus: 'complete' as const, recommendationBasis: [] })
  const route = (): JourneyRoute => ({ id: 'r', legs: [leg('L1', 'T', '往东'), leg('L2', 'D', '往北')], originPath: null, destinationPath: null, doorCombinations: [], walkingMetres: 100, stairCount: 0, rideMinutes: 4, totalMinutes: 10, transferCount: 1, confidence: 'partial', equalChoicesTruncated: false, granularity: 'detailed',
    transfers: [{ stationId: 'T', stationName: 'T', fromLineName: 'L1', toLineName: 'L2', path: { nodes: [], edges: [], metres: 50, minutes: 1, stairCount: 0, instructions: ['走楼梯'] }, instructions: ['从2号车厢3号门下车', '走楼梯', '在L2往往北方向，前往2号车厢3号门候车'] }] })
  const data = (stationId: string, serviceId: string) => ({ provenance: { kind: 'official' }, approvedFacilityPositions: [{ id: 'p', stationId, serviceId, kind: 'lift', positions: [{ car: 4, door: 1 }], reviewRevision: 1 }] }) as unknown as MetroDataset
  it('drops the old alighting door when the arriving leg is replaced', () => {
    const t = applyApprovedPositions(data('T', 'L1'), route(), 'shortest').transfers[0]
    expect(t.path).toBeNull()
    expect(t.instructions.join()).not.toMatch(/2号车厢/)
    expect(t.instructions.at(-1)).toContain('按下一程推荐的车门候车')
  })
  it('drops the old boarding door when the next leg is replaced', () => {
    const t = applyApprovedPositions(data('D', 'L2'), route(), 'shortest').transfers[0]
    expect(t.instructions[0]).toBe('从2号车厢3号门下车')
    expect(t.instructions.at(-1)).toBe('前往L2往往北方向站台，按下一程推荐的车门候车')
  })
})
describe('reviewed facility positions used in planning', () => {
  it('projects only formal records and recommends the correct direction without invented geometry', () => {
    const state = fixture(), data = projectApprovedPositions(state)
    expect(state.dataset.approvedFacilityPositions).toBeUndefined()
    expect(validateDataset(data)).toEqual([])
    expect(data.approvedFacilityPositions).toHaveLength(2)
    for (const [from, expected] of [['fz-五里亭', [8, 2]], ['fz-上洋', [7, 1]]] as const) {
      const result = planJourney(data, { from, to: 'fz-前屿', mode: 'shortest' })
      const route = result.routes.find(r => r.legs.length === 1 && r.legs[0].lineId === 'fz-l2')!
      expect(route.legs[0].recommendations.map(p => p.door)).toEqual(expected)
      expect(recommendationFacilities(route, 0)).toEqual(['lift'])
      expect(positionChoices(route, 0)).toHaveLength(2)
      expect(route.destinationPath).toBeNull()
      expect(route.walkingMetres).toBeNull()
      expect(route.doorCombinations).toEqual([])
      expect(route.confidence).toBe('partial')
    }
  })
  it('uses one known stair group, prefers assisted facilities for few-stairs, and only lifts for elevator', () => {
    const state = fixture(), key = rowKey('fz-前屿', 'fz-l2-forward')
    state.rows[key].楼梯1对应车厢车门 = '2:3'
    let data = projectApprovedPositions(state)
    const query = (mode: 'shortest' | 'few-stairs' | 'elevator') => planJourney(data, { from: 'fz-五里亭', to: 'fz-前屿', mode }).routes.find(r => r.legs.length === 1)!
    expect(query('shortest').legs[0].recommendations.map(p => p.car)).toEqual([2])
    expect(query('few-stairs').legs[0].approvedFacilities).toEqual(['lift'])
    expect(query('elevator').legs[0].approvedFacilities).toEqual(['lift'])
    delete state.rows[key].电梯对应车厢车门
    data = projectApprovedPositions(state)
    expect(query('elevator').legs[0].recommendations).toEqual([])
    state.rows[key]['1是否有上行扶梯'] = '是'
    data = projectApprovedPositions(state)
    expect(query('few-stairs').legs[0].approvedFacilities).toEqual(['escalator'])
  })
  it('supports detail records, clearing and validation and isolates other stations and lines', () => {
    const state = fixture(), key = rowKey('fz-前屿', 'fz-l4-forward')
    state.facilities[`${key}/stairs-A`] = { rowKey: key, 编号: 'stairs-A', 类型: '楼梯', 车门: '1:2', 上行扶梯: '是' }
    state.rows[rowKey('fz-前屿', 'fz-l2-forward')].电梯对应车厢车门 = ''
    const data = projectApprovedPositions(state)
    expect(data.approvedFacilityPositions?.find(p => p.serviceId === 'fz-l4-forward')?.kind).toBe('escalator')
    expect(data.approvedFacilityPositions?.some(p => p.serviceId === 'fz-l2-forward')).toBe(false)
    expect(planJourney(data, { from: 'fz-五里亭', to: 'fz-前屿', mode: 'shortest' }).routes[0].legs[0].recommendations).toEqual([])
    data.approvedFacilityPositions![0].serviceId = 'wrong'
    expect(validateDataset(data).length).toBeGreaterThan(0)
  })
})
