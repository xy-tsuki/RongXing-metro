export interface BoardFrame { x: number; y: number; scale: number }
export const BOARD_MOTION_MS = 180

/** One eased camera frame drives the grid and every capsule; no independent CSS tweens. */
export function animateBoard(from: BoardFrame, to: BoardFrame, render: (frame: BoardFrame) => void) {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined, cancelled = false
  function tick() {
    if (cancelled) return
    const progress = Math.min(1, (Date.now() - started) / BOARD_MOTION_MS)
    const eased = 1 - (1 - progress) ** 3
    render({ x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased,
      scale: from.scale + (to.scale - from.scale) * eased })
    if (progress < 1) timer = setTimeout(tick, Math.min(16, BOARD_MOTION_MS - (Date.now() - started)))
  }
  timer = setTimeout(tick, 16)
  return () => { cancelled = true; if (timer !== undefined) clearTimeout(timer) }
}
