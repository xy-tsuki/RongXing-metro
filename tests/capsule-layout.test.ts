import { describe, expect, it } from 'vitest'
import type { DisplayCandidate } from '../src/navigation/departures'
import { capsuleLayout, CAPSULE_PADDING, MIN_RIDE_HEIGHT, TRANSFER_GAP, minimumCapsuleHeight } from '../src/navigation/capsule-layout'
import { demoDataset } from '../src/data/demo'
import { planJourney } from '../src/core'

const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes[0]
function candidate(minutes: number[], gap = 1): DisplayCandidate {
  let cursor = Date.parse('2026-10-17T09:00:00+08:00')
  const legs = Object.fromEntries(minutes.map((duration, index) => {
    const start = cursor
    cursor += duration * 60_000
    const value = { source: 'demo' as const, departureAt: new Date(start).toISOString(), arrivalAt: new Date(cursor).toISOString() }
    if (index < minutes.length - 1) cursor += gap * 60_000
    return [index, value]
  }))
  return { id: 'test', routeId: route.id, routeIndex: 0, route: { ...route, legs: minutes.map((_, index) => ({ ...route.legs[index % route.legs.length] })) }, timing: { legs } }
}

describe('readable route capsules', () => {
  it.each([[1, 2, 90], [90, 1, 2], [1, 90, 1], [0, 0, 0]])('retains every short leg and keeps all icons inside the rounded ends for %j', (...minutes) => {
    const item = candidate(minutes)
    const original = JSON.stringify(item)
    const layout = capsuleLayout(item, minimumCapsuleHeight(3), true)
    expect(layout.parts).toHaveLength(3)
    expect(layout.parts[0].top).toBe(CAPSULE_PADDING)
    for (const [index, part] of layout.parts.entries()) {
      expect(part.height).toBeGreaterThanOrEqual(MIN_RIDE_HEIGHT)
      // 34px icons sit in the middle of each visible leg, never crossing a rounded end.
      expect(part.top + (part.height - 34) / 2).toBeGreaterThanOrEqual(CAPSULE_PADDING)
      expect(part.top + (part.height + 34) / 2).toBeLessThanOrEqual(layout.height - CAPSULE_PADDING)
      if (index) expect(part.top - layout.parts[index - 1].top - layout.parts[index - 1].height).toBeGreaterThanOrEqual(TRANSFER_GAP - .00001)
    }
    expect(layout.parts[2].top + layout.parts[2].height + CAPSULE_PADDING).toBeCloseTo(layout.height)
    expect(JSON.stringify(item)).toBe(original)
  })
  it('preserves duration proportions for unconstrained pieces while protecting short ones', () => {
    const layout = capsuleLayout(candidate([1, 20, 40], 5), 600, true)
    expect(layout.parts[0].height).toBe(MIN_RIDE_HEIGHT)
    expect(layout.parts[2].height / layout.parts[1].height).toBeCloseTo(2)
    expect(layout.height).toBe(600)
  })
  it('supports direct, untimed and walk-only candidates without dividing by zero', () => {
    expect(capsuleLayout(candidate([1]), 1, true).height).toBe(1)
    const untimed = capsuleLayout(candidate([1, 1, 1]), 400, false)
    expect(untimed.parts[0].height).toBeCloseTo(untimed.parts[2].height)
    const walk = candidate([])
    expect(capsuleLayout(walk, 0, false)).toEqual({ height: 100, parts: [], detailScale: 1 })
  })
  it('centers direct line badges, and anchors interchange endpoints at the two safe edges', () => {
    expect(capsuleLayout(candidate([40]), 300, true).parts.map(part => part.anchor)).toEqual(['center'])
    expect(capsuleLayout(candidate([1, 40]), 300, true).parts.map(part => part.anchor)).toEqual(['start', 'end'])
    expect(capsuleLayout(candidate([1, 2, 40]), 300, true).parts.map(part => part.anchor)).toEqual(['start', 'center', 'end'])
  })
  it('never gives short or multi-leg timed capsules their own height scale', () => {
    for (const scale of [.1, .3, .7, 1]) {
      const short = capsuleLayout(candidate([1, 2, 3]), 16 * 12 * scale, true)
      const long = capsuleLayout(candidate([90]), 95 * 12 * scale, true)
      expect(short.height / long.height).toBeCloseTo(16 / 95)
      expect(short.parts.at(-1)!.top + short.parts.at(-1)!.height).toBeLessThanOrEqual(short.height)
    }
  })
})
