import type { JourneyRoute, MetroDataset, RouteMode, ApprovedFacilityPosition } from './types'

/** Prefer reviewed facts without constructing fictitious walking edges or complete door tuples. */
export function applyApprovedPositions(data: MetroDataset, route: JourneyRoute, mode: RouteMode): JourneyRoute {
  let changed = false
  const legs = route.legs.map(leg => {
    const candidates = (data.approvedFacilityPositions ?? []).filter(p => p.stationId === leg.toStationId && p.serviceId === leg.serviceId)
    let selected: ApprovedFacilityPosition[]
    if (mode === 'elevator') selected = candidates.filter(p => p.kind === 'lift')
    else if (mode === 'few-stairs') {
      const assisted = candidates.filter(p => p.kind !== 'stairs')
      selected = assisted.length ? assisted : candidates
    } else {
      const stairs = candidates.filter(p => p.kind !== 'lift')
      selected = stairs.length ? stairs : candidates
    }
    if (!selected.length) return leg
    changed = true
    const positions = new Map(selected.flatMap(p => p.positions.map(v => [`${v.car}:${v.door}`, { ...v, positionId: `approved:${p.serviceId}:${p.stationId}:${v.car}:${v.door}` }] as const)))
    return { ...leg, recommendations: [...positions.values()], approvedFacilities: [...new Set(selected.map(p => p.kind))], arrivalPath: null,
      recommendationStatus: 'local' as const, recommendationBasis: ['优先采用本方向已审核的设施门位；多个门位均为已录入可选位置', '未测距离、耗时和完整站内通路保持未知，未比较尚未采集的设施'] }
  })
  if (!changed) return route
  // A newly selected local position is not part of any old optimized all-journey combination.
  return { ...route, legs, doorCombinations: [], destinationPath: legs.at(-1)?.approvedFacilities ? null : route.destinationPath,
    transfers: route.transfers.map((t, i) => legs[i].approvedFacilities ? { ...t, path: null, instructions: [t.instructions[0], '下车优先采用本方向已审核设施门位，后续按现场换乘指引通行'] } : t),
    walkingMetres: null, stairCount: null, totalMinutes: null, confidence: data.provenance.kind === 'demo' ? 'demo' : 'partial', granularity: 'partial' }
}
