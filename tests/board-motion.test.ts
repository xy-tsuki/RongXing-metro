import { afterEach, describe, expect, it, vi } from 'vitest'
import { animateBoard, BOARD_MOTION_MS, type BoardFrame } from '../src/navigation/board-motion'
afterEach(() => vi.useRealTimers())
describe('shared eased board camera', () => {
  it('eases rapidly then slows, preserving the same temporal ratio in every frame', () => {
    vi.useFakeTimers()
    const frames: BoardFrame[] = []
    animateBoard({x:0,y:0,scale:1},{x:100,y:120,scale:.4},frame=>frames.push(frame))
    expect(frames).toHaveLength(0)
    vi.advanceTimersByTime(96)
    const middle = frames.at(-1)!
    expect(middle.x).toBeGreaterThan(50); expect(middle.x).toBeLessThan(100)
    for (const frame of frames) {
      expect((16*12*frame.scale)/(25*12*frame.scale)).toBeCloseTo(16/25)
      expect(frame.y/120).toBeCloseTo(frame.x/100)
    }
    vi.advanceTimersByTime(BOARD_MOTION_MS)
    expect(frames.at(-1)).toEqual({x:100,y:120,scale:.4})
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels old frames on interruption and resumes from the current camera without jumping', () => {
    vi.useFakeTimers()
    let current: BoardFrame = {x:0,y:0,scale:1}
    const cancel = animateBoard(current,{x:100,y:120,scale:.4},frame=>{current=frame})
    vi.advanceTimersByTime(48); cancel()
    const interrupted = {...current}
    animateBoard(current,{x:50,y:40,scale:.8},frame=>{current=frame})
    expect(current).toEqual(interrupted)
    vi.advanceTimersByTime(BOARD_MOTION_MS)
    expect(current).toEqual({x:50,y:40,scale:.8})
  })
})
