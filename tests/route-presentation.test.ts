import { describe, expect, it } from 'vitest'
import { planJourney } from '../src/core'
import { demoDataset } from '../src/data/demo'
import { arrivalPathFor, facilitiesIn, groupEquivalentPositions, positionChoices, recommendationFacilities, transferOverview } from '../src/components/route-presentation'

describe('route detail presentation preserves planner evidence', () => {
  it('groups equivalent doors equally by car without losing positions or mutating choices', () => {
    const choices = [
      { position: { car: 6, door: 3, positionId: 'a' }, combinationIndex: 0 },
      { position: { car: 1, door: 2, positionId: 'b' }, combinationIndex: 1 },
      { position: { car: 1, door: 1, positionId: 'c' }, combinationIndex: 2 },
      { position: { car: 1, door: 2, positionId: 'b' }, combinationIndex: 3 },
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

  it('shows facility alternatives across all equivalent combinations instead of only the first', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-river', mode: 'shortest' }).routes[0]
    const alternate = planJourney(demoDataset, { from: 's-west', to: 's-river', mode: 'few-stairs' }).routes[0]
    route.doorCombinations = [route.doorCombinations[0], alternate.doorCombinations[0]]
    expect(recommendationFacilities(route, 0)).toEqual(['stairs', 'escalator'])
  })
  it('lists all equal positions while retaining their full journey correlation', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes[0]
    route.doorCombinations = [route.doorCombinations[0], route.doorCombinations.at(-1)!]
    const choices = positionChoices(route, 0, 0)
    expect(choices).toHaveLength(2)
    const nextIndex = choices[1].combinationIndex!
    expect(nextIndex).toBe(1)
    const path = arrivalPathFor(route, 0, nextIndex)!
    expect(path).toBe(route.doorCombinations[1].transferPaths[0])
    expect(path.nodes[0]).toContain(route.doorCombinations[1].positions[0].positionId)
    expect(path.nodes.at(-1)).toContain(route.doorCombinations[1].positions[1].positionId)
    expect(positionChoices(route, 1, nextIndex).some(c => c.combinationIndex === nextIndex)).toBe(true)
  })

  it('does not switch an already selected position to an incompatible combination', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes[0]
    const selectedIndex = route.doorCombinations.length - 1
    const selected = route.doorCombinations[selectedIndex].positions[0]
    const choice = positionChoices(route, 0, selectedIndex).find(c => c.position.positionId === selected.positionId)!
    expect(choice.combinationIndex).toBe(selectedIndex)
  })

  it('shows actual stairs, escalators and lifts after changing modes', () => {
    for (const [mode, facility] of [['shortest', 'stairs'], ['few-stairs', 'escalator'], ['elevator', 'lift']] as const) {
      const route = planJourney(demoDataset, { from: 's-west', to: 's-river', mode }).routes[0]
      const path = arrivalPathFor(route, 0, 0)!
      expect(facilitiesIn(path)).toEqual([facility])
      expect(path).toBe(route.doorCombinations[0].destinationPath)
    }
    expect(facilitiesIn(null)).toEqual([])
  })

  it('keeps partial recommendations local and does not invent a full combination', () => {
    const route = planJourney(demoDataset, { from: 's-west', to: 's-unknown', mode: 'elevator' }).routes[0]
    expect(route.doorCombinations).toEqual([])
    route.legs[0].recommendations = [{ car: 2, door: 1, positionId: 'survey-door' }]
    expect(positionChoices(route, 0, 0)).toEqual([{ position: route.legs[0].recommendations[0], combinationIndex: null }])
    const last = route.legs.length - 1
    expect(arrivalPathFor(route, last, 0)).toBeNull()
  })
})
