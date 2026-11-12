import { describe, expect, it } from 'vitest'
import { planJourney } from '../src/core'
import { demoDataset } from '../src/data/demo'
import { arrivalPathFor, facilitiesIn, groupEquivalentPositions, positionChoices, recommendationFacilities, transferOverview } from '../src/components/route-presentation'

describe('route detail presentation preserves planner evidence', () => {
  it('groups equivalent doors equally by car without losing positions or mutating choices', () => {
    const choices = [
      { position: { car: 6, door: 3, positionId: 'a' } },
      { position: { car: 1, door: 2, positionId: 'b' } },
      { position: { car: 1, door: 1, positionId: 'c' } },
      { position: { car: 1, door: 2, positionId: 'b' } },
    ]
    expect(groupEquivalentPositions(choices)).toEqual([{ car: 1, doors: [1, 2] }, { car: 6, doors: [3] }])
    expect(choices[0].position.car).toBe(6)
    expect(groupEquivalentPositions([])).toEqual([])
  })

  it('summarizes only recorded transfer facilities and keeps missing paths explicitly unknown', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'elevator' }).routes[0]
    const guide = route.transfers[0]
    expect(transferOverview(guide, guide.path)).toBe('经电梯前往2号线站台')
    expect(transferOverview(guide, null)).toContain('待核实')
    expect(transferOverview(guide, null)).not.toContain('电梯')
    const external = { ...guide, kind: 'external' as const, instructions: ['出站前往另一车站重新进站'] }
    expect(transferOverview(external, null)).toBe(external.instructions[0])
  })

  it('shows facility alternatives across all equally good doors of the leg instead of only the first', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-river', mode: 'shortest' }).routes[0]
    const alternate = planJourney(demoDataset, { from: 's-west', to: 's-river', mode: 'few-stairs' }).routes[0]
    route.legs[0].recommendations = [route.legs[0].recommendations[0], alternate.legs[0].recommendations[0]]
    expect(recommendationFacilities(route, 0)).toEqual(['stairs', 'escalator'])
  })
  it('lists the equal doors of each leg independently, without cross-leg correlation', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes[0]
    route.legs.forEach((leg, index) => expect(positionChoices(route, index).map(c => c.position)).toEqual(leg.recommendations))
    expect(positionChoices(route, 0)).toHaveLength(2)
    // 换乘路径是「下车门 → 下一程站台」，取自本段推荐门自己的通路。
    expect(arrivalPathFor(route, 0)).toBe(route.legs[0].recommendations[0].arrivalPath)
    expect(arrivalPathFor(route, 0)!.nodes[0]).toContain(route.legs[0].recommendations[0].positionId)
    expect(arrivalPathFor(route, 0)).toBe(route.transfers[0].path)
  })

  it('shows actual stairs, escalators and lifts after changing modes', () => {
    for (const [mode, facility] of [['shortest', 'stairs'], ['few-stairs', 'escalator'], ['elevator', 'lift']] as const) {
      const route = planJourney(demoDataset, { from: 's-west', to: 's-river', mode }).routes[0]
      const path = arrivalPathFor(route, 0)!
      expect(facilitiesIn(path)).toEqual([facility])
      expect(path).toBe(route.destinationPath)
    }
    expect(facilitiesIn(null)).toEqual([])
  })

  it('keeps partial recommendations local and invents no path', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-unknown', mode: 'elevator' }).routes[0]
    route.legs[0].recommendations = [{ car: 2, door: 1, positionId: 'survey-door' }]
    expect(positionChoices(route, 0)).toEqual([{ position: route.legs[0].recommendations[0] }])
    const last = route.legs.length - 1
    expect(arrivalPathFor(route, last)).toBeNull()
  })
})
