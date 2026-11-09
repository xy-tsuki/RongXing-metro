import type { DisplayCandidate } from './departures'

export const MIN_RIDE_HEIGHT = 48
export const TRANSFER_GAP = 30
export const CAPSULE_PADDING = 16
export const minimumCapsuleHeight = (legCount: number) =>
  legCount ? CAPSULE_PADDING * 2 + legCount * MIN_RIDE_HEIGHT + (legCount - 1) * TRANSFER_GAP : 100

/** Fit proportional pieces with readable lower bounds; never change any journey times. */
function distribute(weights: number[], minima: number[], available: number): number[] {
  const positive = weights.filter(weight => weight > 0)
  const effective = positive.length ? weights : weights.map(() => 1)
  let low = 0, high = available / Math.min(...(positive.length ? positive : [1]))
  for (let step = 0; step < 40; step++) {
    const scale = (low + high) / 2
    if (effective.reduce((total, weight, index) => total + Math.max(minima[index], weight * scale), 0) > available) high = scale
    else low = scale
  }
  return effective.map((weight, index) => Math.max(minima[index], weight * low))
}

const elapsed = (start?: string, end?: string) => {
  const value = Date.parse(end ?? '') - Date.parse(start ?? '')
  return Number.isFinite(value) && value >= 0 ? value / 60_000 : null
}

export function capsuleLayout(item: DisplayCandidate, desiredHeight: number, timed: boolean) {
  const count = item.route.legs.length
  const height = timed ? Math.max(0, desiredHeight) : Math.max(minimumCapsuleHeight(count), desiredHeight)
  // Internal readability must never inflate a timed capsule and falsify its duration.
  const detailScale = Math.min(1, height / minimumCapsuleHeight(count))
  if (!count) return { height, parts: [], detailScale }
  const weights: number[] = [], minima: number[] = []
  item.route.legs.forEach((_, index) => {
    const current = item.timing.legs?.[index]
    if (index) {
      weights.push(timed ? elapsed(item.timing.legs?.[index - 1]?.arrivalAt, current?.departureAt) ?? 1 : 1)
      minima.push(TRANSFER_GAP)
    }
    weights.push(timed ? elapsed(current?.departureAt, current?.arrivalAt) ?? 1 : 1)
    minima.push(MIN_RIDE_HEIGHT)
  })
  const padding = CAPSULE_PADDING * detailScale
  const pieces = distribute(weights, minima.map(value => value * detailScale), height - padding * 2)
  let cursor = padding
  const parts = item.route.legs.map((_, index) => {
    const gap = index ? pieces[index * 2 - 1] : 0
    cursor += gap
    const anchor = count === 1 ? 'center' : index === 0 ? 'start' : index === count - 1 ? 'end' : 'center'
    const part = { top: cursor, height: pieces[index * 2], transferOffset: -gap / 2, anchor }
    cursor += part.height
    return part
  })
  return { height, parts, detailScale }
}
