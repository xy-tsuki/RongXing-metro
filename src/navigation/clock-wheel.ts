export interface ClockWheelState { hour: number; minute: number; indices: [number, number] }
const wrap = (value: number, period: number) => ((value % period) + period) % period
export const clockWheelItems = (period: number) => Array.from({ length: period * 3 }, (_, i) => String(i % period).padStart(2, '0'))
export function clockWheelState(time: string): ClockWheelState {
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
  const [hour, minute] = valid ? time.split(':').map(Number) : [0, 0]
  return { hour, minute, indices: [24 + hour, 60 + minute] }
}
/** Only changes the clock. Calendar dates deliberately never enter this controller. */
export function moveClockWheel(previous: ClockWheelState, indices: readonly number[]): ClockWheelState {
  if (indices.length !== 2 || indices.some((v, i) => !Number.isInteger(v) || v < 0 || v >= [72, 180][i])) return previous
  const minute = previous.minute + indices[1] - previous.indices[1]
  const hour = wrap(previous.hour + indices[0] - previous.indices[0] + Math.floor(minute / 60), 24)
  const nextMinute = wrap(minute, 60)
  // Recenter identical repeated labels so neither column reaches a physical end.
  return { hour, minute: nextMinute, indices: [24 + hour, 60 + nextMinute] }
}
export function clockWheelText(state: ClockWheelState) { return `${String(state.hour).padStart(2, '0')}:${String(state.minute).padStart(2, '0')}` }
