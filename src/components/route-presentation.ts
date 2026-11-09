import { transitDisplayText } from '../navigation/line-display'
import type { DoorRecommendation, JourneyRoute, TransferGuide, WalkEdge, WalkPath } from '../core/types'

export type FacilityKind = Exclude<WalkEdge['kind'], 'walk'>
export const facilityNames: Record<FacilityKind, string> = { stairs: '楼梯', escalator: '扶梯', lift: '电梯' }
export const facilitiesIn = (path?: WalkPath | null): FacilityKind[] =>
  [...new Set((path?.edges ?? []).filter(edge => edge.kind !== 'walk').map(edge => edge.kind as FacilityKind))]

/** The station heading already supplies this context; retain floors, facilities and measurements. */
export const compactInstruction = (instruction: string, stationName: string): string =>
  transitDisplayText(instruction).split(stationName).join('').replace('（出口未指定）', '')

export interface PositionChoice { position: DoorRecommendation; combinationIndex: number | null }

export function groupEquivalentPositions(choices: PositionChoice[]): { car: number; doors: number[] }[] {
  const groups = new Map<number, Set<number>>()
  for (const { position } of choices) {
    if (!groups.has(position.car)) groups.set(position.car, new Set())
    groups.get(position.car)!.add(position.door)
  }
  return [...groups].sort(([a], [b]) => a - b).map(([car, doors]) => ({ car, doors: [...doors].sort((a, b) => a - b) }))
}

export function transferOverview(guide: TransferGuide, path?: WalkPath | null): string {
  if (guide.kind === 'external') return transitDisplayText(guide.instructions[0] ?? '出站换乘，具体通路待核实')
  if (!path) return `前往${transitDisplayText(guide.toLineName).replace('演示', '')}，具体换乘通路待核实`
  const names = facilitiesIn(path).map(kind => facilityNames[kind]).join('、')
  return `${names ? '经' + names : '沿平层通道'}前往${transitDisplayText(guide.toLineName).replace('演示', '')}站台`
}

export function recommendationFacilities(route: JourneyRoute, index: number): FacilityKind[] {
  if (route.legs[index]?.approvedFacilities?.length) return route.legs[index].approvedFacilities!
  const paths = route.doorCombinations.length
    ? route.doorCombinations.map((_, ci) => arrivalPathFor(route, index, ci))
    : [arrivalPathFor(route, index, 0)]
  return [...new Set(paths.flatMap(facilitiesIn))]
}
/** Keep a position linked to a complete compatible journey, never build a Cartesian product in the UI. */
export function positionChoices(route: JourneyRoute, legIndex: number, selectedCombination: number): PositionChoice[] {
  const choices = new Map<string, PositionChoice>()
  route.doorCombinations.forEach((combination, index) => {
    const position = combination.positions[legIndex]
    if (!position) return
    const key = `${position.car}:${position.door}`
    if (!choices.has(key) || index === selectedCombination) choices.set(key, { position, combinationIndex: index })
  })
  if (!route.doorCombinations.length) for (const position of route.legs[legIndex]?.recommendations ?? []) {
    choices.set(`${position.car}:${position.door}`, { position, combinationIndex: null })
  }
  return [...choices.values()]
}

export function arrivalPathFor(route: JourneyRoute, legIndex: number, selectedCombination: number): WalkPath | null {
  const combination = route.doorCombinations[selectedCombination]
  if (combination) return legIndex < route.legs.length - 1 ? combination.transferPaths[legIndex] ?? null : combination.destinationPath
  return route.legs[legIndex]?.arrivalPath ?? route.transfers[legIndex]?.path ??
    (legIndex === route.legs.length - 1 ? route.destinationPath : null)
}

export function lineInk(_hex: string): string {
  return '#ffffff'
}
