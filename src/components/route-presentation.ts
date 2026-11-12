import { transitDisplayText } from '../navigation/line-display'
import type { DoorRecommendation, JourneyRoute, TransferGuide, WalkEdge, WalkPath } from '../core/types'

export type FacilityKind = Exclude<WalkEdge['kind'], 'walk'>
export const facilityNames: Record<FacilityKind, string> = { stairs: '楼梯', escalator: '扶梯', lift: '电梯' }
export const facilitiesIn = (path?: WalkPath | null): FacilityKind[] =>
  [...new Set((path?.edges ?? []).filter(edge => edge.kind !== 'walk').map(edge => edge.kind as FacilityKind))]

/** The station heading already supplies this context; retain floors, facilities and measurements. */
export const compactInstruction = (instruction: string, stationName: string): string =>
  transitDisplayText(instruction).split(stationName).join('').replace('（出口未指定）', '')

export interface PositionChoice { position: DoorRecommendation }

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
  const paths = (route.legs[index]?.recommendations ?? []).flatMap(position => position.arrivalPath ? [position.arrivalPath] : [])
  return [...new Set((paths.length ? paths : [arrivalPathFor(route, index)]).flatMap(facilitiesIn))]
}
/** 每段的推荐门只由该段终点的设施决定，各段互相独立；这里只按本段原样列出，不做跨段配套。 */
export function positionChoices(route: JourneyRoute, legIndex: number): PositionChoice[] {
  return (route.legs[legIndex]?.recommendations ?? []).map(position => ({ position }))
}

/** 本段下车后的通路：换乘站为「下车门 → 下一程站台」，目的站为「下车门 → 付费站厅」。 */
export function arrivalPathFor(route: JourneyRoute, legIndex: number): WalkPath | null {
  return route.legs[legIndex]?.arrivalPath ?? route.transfers[legIndex]?.path ??
    (legIndex === route.legs.length - 1 ? route.destinationPath : null)
}

export function lineInk(_hex: string): string {
  return '#ffffff'
}
