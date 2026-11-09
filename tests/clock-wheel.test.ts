import { describe, expect, it } from 'vitest'
import { clockWheelState, clockWheelText, moveClockWheel } from '../src/navigation/clock-wheel'
const move = (time: string, column: number, delta: number) => {
  const state = clockWheelState(time), indices = [...state.indices]
  indices[column] += delta
  return clockWheelText(moveClockWheel(state, indices))
}
describe('cyclic departure clock, independent from the date', () => {
  it.each([['10:59',1,1,'11:00'],['11:00',1,-1,'10:59'],['23:59',1,1,'00:00'],['00:00',1,-1,'23:59'],['23:27',0,1,'00:27'],['00:27',0,-1,'23:27'],['22:58',1,5,'23:03'],['00:02',1,-5,'23:57']])('%s column %s delta %s → %s', (time,column,delta,expected) => {
    expect(move(String(time), Number(column), Number(delta))).toBe(expected)
  })
  it('recenters repeated cycles and ignores the programmatic recenter notification', () => {
    let state = clockWheelState('23:59')
    for (let n=0; n<3000; n++) {
      state = moveClockWheel(state, [state.indices[0],state.indices[1]+1])
      const same = moveClockWheel(state, state.indices)
      expect(same).toEqual(state)
      expect(state.indices[0]).toBeGreaterThanOrEqual(24)
      expect(state.indices[0]).toBeLessThan(48)
      expect(state.indices[1]).toBeGreaterThanOrEqual(60)
      expect(state.indices[1]).toBeLessThan(120)
    }
    expect(clockWheelText(state)).toBe('01:59')
  })
  it('rejects invalid picker indices', () => {
    const state=clockWheelState('08:30')
    for (const indices of [[NaN,60],[24,180],[-1,60],[24], [24,1.2]]) expect(moveClockWheel(state,indices)).toBe(state)
  })
})
