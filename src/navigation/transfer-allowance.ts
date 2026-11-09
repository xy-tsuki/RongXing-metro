import type { MetroDataset, RouteMode, TransferGuide, WalkPath } from '../core/types'

/** User-set planning allowances, never surveyed station or accessibility facts. */
const presets: Record<RouteMode, { indoor: number; external: number }> = {
  shortest: { indoor: 3, external: 10 },
  'few-stairs': { indoor: 5, external: 13 },
  elevator: { indoor: 7, external: 15 },
}
const knownMinutes = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

export function transferAllowance(guide?: TransferGuide, path?: WalkPath | null, dataset?: MetroDataset, mode: RouteMode = 'shortest') {
  const external = guide?.kind === 'external' ? dataset?.externalTransfers?.find(link =>
    link.fromStationId === guide.fromStationId && link.toStationId === guide.toStationId ||
    link.bidirectional && link.toStationId === guide.fromStationId && link.fromStationId === guide.toStationId) : undefined
  const measured = knownMinutes(path?.minutes) ?? knownMinutes(guide?.path?.minutes) ?? knownMinutes(external?.minutes)
  if (measured !== undefined) return { minutes: measured, preset: false }
  return { minutes: presets[mode][guide?.kind === 'external' ? 'external' : 'indoor'], preset: true }
}
