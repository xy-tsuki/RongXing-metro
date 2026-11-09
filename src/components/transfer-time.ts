import type { MetroDataset, RouteMode, TransferGuide, WalkPath } from '../core/types'
import { validMinutes, type TimingValue } from '../navigation/timing'
import { transferAllowance } from '../navigation/transfer-allowance'

/** A visible planning allowance only: do not write the preset into route costs or clocks. */
export function transferTimePresentation(guide: TransferGuide, path?: WalkPath | null, timing?: TimingValue, dataset?: MetroDataset, mode: RouteMode = 'shortest') {
  const allowance = transferAllowance(guide, path, dataset, mode)
  const duration = validMinutes(timing?.durationMinutes)
  const walking = validMinutes(timing?.walkingMinutes) ?? validMinutes(path?.minutes)
  const known = duration ?? walking ?? (allowance.preset ? null : validMinutes(allowance.minutes))
  return {
    minutes: known ?? allowance.minutes,
    preset: known === null,
    label: duration !== null || walking === null ? '换乘约' : '步行约',
    waitingMinutes: validMinutes(timing?.waitingMinutes),
    source: timing?.source ?? (dataset?.provenance.kind === 'demo' ? 'demo' : 'estimate'),
  }
}
