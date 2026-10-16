import type { MetroDataset } from '../core/types'

/** Development-only visual fixture; never replaces the published navigation dataset. */
export function applyLongStationNames(data: MetroDataset): void {
  const names: Record<string, string> = {
    's-west': '西门综合交通枢纽站',
    's-central': '中央广场城市会客厅站',
    's-science': '科创园高新技术产业园站',
    's-bay': '滨江海湾国际会展中心站'
  }
  for (const station of data.stations) {
    const previous = station.name
    if (!names[station.id]) continue
    station.name = names[station.id]
    for (const node of data.walkNodes) node.label = node.label.split(previous).join(station.name)
  }
  for (const service of data.services) {
    service.direction = data.stations.find(s => s.id === service.stops[service.stops.length - 1].stationId)!.name
  }
}
