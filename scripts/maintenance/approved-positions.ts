import type { ApprovedFacilityPosition, MetroDataset } from '../../src/core/types'
import { positions, type Catalog } from '../../src/maintenance/catalog'

/** Catalog contains formal reviewed values only; pending batches are never projected. */
export function projectApprovedPositions(state: Catalog): MetroDataset {
  const result: ApprovedFacilityPosition[] = []
  const add = (rowKey: string, id: string, kind: ApprovedFacilityPosition['kind'], doors: string | undefined) => {
    if (!doors || doors === '【清空】') return
    const [stationId, serviceId] = JSON.parse(rowKey)
    const service = state.dataset.services.find(s => s.id === serviceId)
    if (!service?.stops.some(s => s.stationId === stationId)) throw new Error('已审核门位的站台方向引用无效')
    const formation = state.dataset.formations.find(f => f.id === service.formationId)!
    result.push({ id, stationId, serviceId, kind, positions: positions(doors, formation.cars), reviewRevision: state.revision })
  }
  for (const [key, row] of Object.entries(state.rows)) {
    add(key, `${key}/lift`, 'lift', row.电梯对应车厢车门)
    for (const group of [1, 2, 3]) add(key, `${key}/stairs-${group}`, row[`${group}是否有上行扶梯`] === '是' ? 'escalator' : 'stairs', row[`楼梯${group}对应车厢车门`])
  }
  for (const [key, row] of Object.entries(state.facilities)) add(row.rowKey, key, row.类型 === '电梯' ? 'lift' : row.类型 === '扶梯' || row.上行扶梯 === '是' ? 'escalator' : 'stairs', row.车门)
  return { ...state.dataset, approvedFacilityPositions: result }
}
