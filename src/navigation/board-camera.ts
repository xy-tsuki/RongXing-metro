import { BOARD_TOP } from './departures'

export interface BoardShape { top: number; height: number }
// Arrival, next-day label, fare, transfer count, path and source caption.
export const BOARD_FOOTER = 188

/** Protect the first three, central three, or final three columns. Other columns may clip. */
export function protectedColumns(input: { x: number; viewportWidth: number; stride: number; columnWidth: number; inset: number; count: number }) {
  const { x, viewportWidth, stride, columnWidth, inset, count } = input
  if (count <= 3) return Array.from({ length: count }, (_, i) => i)
  const end = inset + (count - 1) * stride + columnWidth
  const first = x <= .5 ? 0 : end - x <= viewportWidth + .5 ? count - 3
    : Math.max(0, Math.min(count - 3, Math.round((x + viewportWidth / 2 - inset - columnWidth / 2) / stride) - 1))
  return [first, first + 1, first + 2]
}

/** A single linear time scale for the grid and EVERY capsule. No per-capsule height clamps. */
export function fitBoardCamera(input: {
  x: number; viewportWidth: number; viewportHeight: number; stride: number;
  columnWidth: number; inset: number; shapes: BoardShape[]; timed: boolean; preferredY?: number
}) {
  const { x, viewportHeight, shapes, timed } = input
  const visible = protectedColumns({ ...input, count: shapes.length }).map(i => shapes[i])
  if (!visible.length) return { x, y: 0, scale: 1 }
  const start = !timed || x <= .5 ? 0 : Math.max(0, Math.min(...visible.map(shape => shape.top)) - BOARD_TOP)
  const available = Math.max(1, viewportHeight - BOARD_TOP - BOARD_FOOTER)
  const extent = Math.max(...visible.map(shape => shape.top - BOARD_TOP - start + shape.height))
  const scale = Math.min(1, available / Math.max(1, extent))
  const upper = Math.max(0, Math.min(...visible.map(shape => (shape.top - BOARD_TOP) * scale)))
  const lower = Math.max(0, Math.max(...visible.map(shape => BOARD_TOP + (shape.top - BOARD_TOP + shape.height) * scale + BOARD_FOOTER - viewportHeight)))
  const y = input.preferredY === undefined ? start * scale : Math.max(lower, Math.min(upper, input.preferredY))
  return { x, y, scale }
}

/** Quarter-hour boundaries, independent of the selected departure minute and zoom. */
export function quarterHourTicks(startAt: string, endAt: string) {
  const step = 15 * 60_000, start = Date.parse(startAt), end = Date.parse(endAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const ticks: { at: string; minutes: number }[] = []
  for (let time = Math.floor(start / step) * step; time <= end; time += step)
    ticks.push({ at: new Date(time).toISOString(), minutes: (time - start) / 60_000 })
  return ticks
}

/** Preserve a short final scroll range instead of snapping it back to the previous column. */
export function snapBoardX(x: number, maxX: number, stride: number) {
  const clamped = Math.max(0, Math.min(maxX, x))
  return clamped > 0 && maxX - clamped < stride / 2 ? maxX : Math.min(maxX, Math.round(clamped / stride) * stride)
}
