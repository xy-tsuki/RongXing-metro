import { describe, expect, it } from 'vitest'
import { boardGestureAxis } from '../src/navigation/board-gesture'

describe('route board directional ownership', () => {
  it('does not turn tap jitter into board dragging', () => {
    expect(boardGestureAxis('', 4, 6)).toBe('')
  })
  it('leaves vertical and ambiguous diagonal movements to page scrolling', () => {
    expect(boardGestureAxis('', 2, -30)).toBe('vertical')
    expect(boardGestureAxis('', -12, 12)).toBe('vertical')
  })
  it('takes horizontal swipes and locks direction until release', () => {
    expect(boardGestureAxis('', -30, 8)).toBe('horizontal')
    expect(boardGestureAxis('horizontal', -40, 60)).toBe('horizontal')
    expect(boardGestureAxis('vertical', -80, 45)).toBe('vertical')
  })
})
