export type BoardGestureAxis = '' | 'horizontal' | 'vertical'
/** Lock once the user has moved beyond tap jitter; vertical gestures belong to the page. */
export function boardGestureAxis(current: BoardGestureAxis, dx: number, dy: number): BoardGestureAxis {
  if (current || Math.max(Math.abs(dx), Math.abs(dy)) < 7) return current
  return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
}
