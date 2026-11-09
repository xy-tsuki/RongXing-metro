import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { fuzhouDataset } from '../src/data/fuzhou'
import { demoDataset } from '../src/data/demo'
import { planJourney } from '../src/core'
import type { Service, TransferGuide, WalkPath } from '../src/core/types'
import { serviceClassFor, serviceClassLabels } from '../src/navigation/service-class'
import { stationsOnLine } from '../src/navigation/station-selection'
import { transferTimePresentation } from '../src/components/transfer-time'

describe('explicit train class presentation', () => {
  it('recognizes the actual ordinary F1 service metadata in both directions', () => {
    const services = fuzhouDataset.services.filter(service => service.lineId === 'fz-f1')
    expect(services).toHaveLength(2)
    expect(services.map(service => serviceClassFor(service))).toEqual(['local', 'local'])
  })
  it('supports all three per-run classes without changing the underlying stopping pattern', () => {
    const service = fuzhouDataset.services.find(service => service.lineId === 'fz-f1')!
    const original = JSON.stringify(service)
    expect(serviceClassLabels[serviceClassFor(service, 'local')!]).toBe('普通')
    expect(serviceClassLabels[serviceClassFor(service, 'limited-express')!]).toBe('大站快车')
    expect(serviceClassLabels[serviceClassFor(service, 'direct-express')!]).toBe('直达快车')
    expect(JSON.stringify(service)).toBe(original)
    const explicitLabel = { ...service, serviceLabel: '直达快车' }
    expect(serviceClassFor(explicitLabel)).toBe('direct-express')
  })
  it('does not infer a class from a line name, short service or an unknown label', () => {
    expect(serviceClassFor(undefined)).toBeUndefined()
    expect(serviceClassFor(demoDataset.services[0])).toBeUndefined()
    const unknown = { id: 'short', lineId: 'fz-f1', direction: '机场', formationId: 'train', stops: [], serviceLabel: '待核实' } satisfies Service & { serviceLabel: string }
    expect(serviceClassFor(unknown)).toBeUndefined()
  })
})

describe('line-first station selection', () => {
  it('uses full stopping order even if an express pattern is listed first, deduplicating reverse trips', () => {
    const services = fuzhouDataset.services.filter(service => service.lineId === 'fz-f1')
    const dataset = { ...fuzhouDataset, services: [{ ...services[0], id: 'express-test', stops: [services[0].stops[0], services[0].stops.at(-1)!] }, ...services] }
    const stations = stationsOnLine(dataset, 'fz-f1')
    expect(stations.map(station => station.id)).toEqual(services[0].stops.map(stop => stop.stationId))
    expect(new Set(stations.map(station => station.id)).size).toBe(stations.length)
    expect(stationsOnLine(dataset, 'unknown')).toEqual([])
  })
  it('keeps the two independent 三叉街 stations on their own lines', () => {
    const metro = stationsOnLine(fuzhouDataset, 'fz-l1').filter(station => station.id === 'fz-三叉街')
    const f1 = stationsOnLine(fuzhouDataset, 'fz-f1').filter(station => station.id === 'fz-三叉街-滨海快线')
    expect(metro).toHaveLength(1); expect(f1).toHaveLength(1)
    expect(metro[0].id).not.toBe(f1[0].id)
  })
})

const guide: TransferGuide = { stationId: 'test', stationName: '测试站', fromLineName: '甲线', toLineName: '乙线', path: null, instructions: [] }
const path = (minutes: number): WalkPath => ({ minutes, metres: 40, nodes: [], edges: [], instructions: [], stairCount: 0 })
describe('visible transfer allowance', () => {
  it('defaults unknown or invalid shortest-mode times to three minutes; waiting alone is not traversal data', () => {
    expect(transferTimePresentation(guide)).toMatchObject({ minutes: 3, preset: true, label: '换乘约' })
    expect(transferTimePresentation(guide, path(NaN), { source: 'estimate', walkingMinutes: -1, waitingMinutes: 2 }))
      .toMatchObject({ minutes: 3, preset: true, waitingMinutes: 2 })
  })
  it('preserves measured zero and uses existing path time when optional enrichment has no traversal time', () => {
    expect(transferTimePresentation(guide, path(0))).toMatchObject({ minutes: 0, preset: false })
    expect(transferTimePresentation(guide, path(2.2), { source: 'demo', waitingMinutes: 1 }))
      .toMatchObject({ minutes: 3, preset: false, label: '步行约', waitingMinutes: 1 })
    expect(transferTimePresentation(guide, path(3), { source: 'timetable', durationMinutes: 7 }))
      .toMatchObject({ minutes: 7, preset: false, label: '换乘约' })
  })
  it('uses a recorded external transfer allowance in either authorized direction', () => {
    const dataset = { ...demoDataset, externalTransfers: [{ id: 'link', fromStationId: 'a', toStationId: 'b', bidirectional: true, minutes: 8, walkingMetres: null, wheelchair: 'unknown' as const, provenance: demoDataset.provenance }] }
    expect(transferTimePresentation({ ...guide, kind: 'external', fromStationId: 'b', toStationId: 'a' }, null, undefined, dataset))
      .toMatchObject({ minutes: 8, preset: false })
  })
  it('keeps real unknown totals and inaccessible paths unchanged after display projection', () => {
    const result = planJourney(fuzhouDataset, { from: 'fz-南门兜', to: 'fz-机场', mode: 'elevator' })
    const original = JSON.stringify(result)
    expect(result.routes.length).toBeGreaterThan(0)
    const transfer = result.routes[0].transfers[0]
    expect(transfer).toBeDefined()
    expect(transferTimePresentation(transfer, transfer.path)).toMatchObject({ minutes: 3, preset: true })
    expect(result.routes[0].totalMinutes).toBeNull()
    expect(result.routes[0].granularity).toBe('basic')
    expect(JSON.stringify(result)).toBe(original)
  })
})

describe('session lifetime beyond its initial page', () => {
  it('keeps route computeds reactive when reLaunch destroys the page that created the session', async () => {
    vi.stubGlobal('uni', { getStorageSync: () => undefined })
    try {
      const { useJourneySession } = await import('../src/navigation/session')
      const pageScope = effectScope()
      const session = pageScope.run(() => {
        const session = useJourneySession()
        session.from.value = 'fz-南门兜'; session.to.value = 'fz-机场'; session.calculate()
        // Exercise the untimed route projection independently of optional timetable providers.
        session.candidateRuns.value = []; session.timetableAvailable.value = false
        expect(session.route.value?.transferCount).toBe(1)
        return session
      })!
      pageScope.stop()
      const other = session.candidates.value.find(candidate => candidate.routeIndex === 2)!
      expect(other.route.legs).toHaveLength(3)
      session.selectDeparture(other.id)
      expect(session.selectedRoute.value).toBe(2)
      expect(session.route.value?.id).toBe(other.routeId)
      expect(session.route.value?.legs).toHaveLength(3)
    } finally { vi.unstubAllGlobals() }
  })
})
