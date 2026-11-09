import { describe, expect, it } from 'vitest'
import network from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
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
      expect(positionChoices(route, 0, 0)).toHaveLength(2)
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
