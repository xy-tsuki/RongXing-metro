import { describe, expect, it } from 'vitest'
import { planJourney, validateDataset } from '../src/core'
import type { MetroDataset } from '../src/core'
import { demoDataset } from '../src/data/demo'
import { fuzhouDataset, fuzhouDataErrors } from '../src/data/fuzhou'

function basicFixture(): MetroDataset {
  const d = JSON.parse(JSON.stringify(demoDataset)) as MetroDataset
  d.city = { id: 'generic-basic-city', name: '基础线网测试城市' }
  d.provenance = { kind: 'official', source: '自动化测试线网，不是实际导航资料', recordedAt: '2026-10-16' }
  d.stations.forEach(s => { s.concourseNodeIds = []; s.indoorData = 'missing' })
  d.formations.forEach(f => { f.cars = 6; f.positions = []; f.doorsKnown = false; f.numberingStatus = 'unknown' })
  d.platforms = []; d.walkNodes = []; d.walkEdges = []
  d.services.forEach(s => s.stops.forEach(stop => { stop.platformId = null; stop.minutesFromPrevious = null }))
  return d
}

describe('topology-first routing with honest unknown data', () => {
  it('accepts known formations without inventing door counts, platforms or travel times', () => {
    const d = basicFixture()
    expect(validateDataset(d)).toEqual([])
    for (const mode of ['shortest', 'few-stairs'] as const) {
      const result = planJourney(d, { from: 's-west', to: 's-bay', mode })
      expect(result.status).toBe('ok')
      const route = result.routes[0]
      expect(route.granularity).toBe('basic')
      expect(route.transferCount).toBe(2)
      expect(route.legs.map(l => l.direction)).toEqual(['滨江', '缺测站', '东岸'])
      expect(route.legs.every(l => l.recommendations.length === 0 && l.recommendationStatus === 'pending' && l.formationCars === 6)).toBe(true)
      expect([route.walkingMetres, route.stairCount, route.rideMinutes, route.totalMinutes]).toEqual([null, null, null, null])
      expect(route.originPath).toBeNull(); expect(route.destinationPath).toBeNull()
      expect(route.confidence).toBe('topology-only')
    }
  })
  it('keeps base train navigation visible in elevator mode without claiming continuous accessibility', () => {
    const result = planJourney(basicFixture(), { from: 's-west', to: 's-bay', mode: 'elevator' })
    expect(result.status).toBe('incomplete')
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.routes.every(r => r.confidence !== 'verified')).toBe(true)
    expect(result.diagnostics.join(' ')).toContain('电梯覆盖不等于连续无障碍通行已核实')
  })
  it('updates local alighting doors after recording only the destination station', () => {
    const d = basicFixture(), stationId = 's-river'
    const station = d.stations.find(s => s.id === stationId)!, source = demoDataset.stations.find(s => s.id === stationId)!
    station.concourseNodeIds = [...source.concourseNodeIds]; station.indoorData = 'partial'
    d.platforms = JSON.parse(JSON.stringify(demoDataset.platforms.filter(p => p.stationId === stationId)))
    d.walkNodes = JSON.parse(JSON.stringify(demoDataset.walkNodes.filter(n => n.stationId === stationId)))
    const nodes = new Set(d.walkNodes.map(n => n.id))
    d.walkEdges = JSON.parse(JSON.stringify(demoDataset.walkEdges.filter(e => nodes.has(e.from))))
    d.formations[0].positions = demoDataset.formations[0].positions.slice(2, 4).map(p => ({ ...p, longitudinalMetres: null, numberingConfirmed: true }))
    d.services.forEach(service => service.stops.forEach(stop => { if (stop.stationId === stationId) stop.platformId = `${stationId}:${service.lineId}:${service.id.endsWith('inbound') ? 'inbound' : 'outbound'}` }))
    // Only use the existing l1 service here; no fabricated l4 platform is inferred.
    d.services = d.services.filter(s => s.lineId === 'l1')
    expect(validateDataset(d)).toEqual([])
    let result = planJourney(d, { from: 's-west', to: stationId, mode: 'elevator' })
    expect(result.status).toBe('incomplete')
    expect(result.routes[0].granularity).toBe('partial')
    expect(result.routes[0].legs[0].recommendationStatus).toBe('local')
    expect(result.routes[0].legs[0].recommendations.map(p => p.positionId)).toEqual(['p3', 'p4'])
    expect(result.routes[0].legs[0].arrivalPath!.nodes.at(-1)).toBe('s-river:hall')
    expect(result.routes[0].walkingMetres).toBeNull()
    for (const edge of d.walkEdges) if (edge.from.endsWith(':lift') && edge.to.endsWith(':p4')) { edge.metres = 0; edge.seconds = 1 }
    result = planJourney(d, { from: 's-west', to: stationId, mode: 'elevator' })
    expect(result.routes[0].legs[0].recommendations.map(p => p.positionId)).toEqual(['p4'])
  })
  it('routes official out-of-station connections explicitly and keeps their metrics unknown', () => {
    const d = basicFixture()
    d.services = [d.services.find(s => s.id === 'l1-outbound')!, d.services.find(s => s.id === 'l3-outbound')!]
    d.externalTransfers = [{ id: 'external-example', fromStationId: 's-river', toStationId: 's-science', bidirectional: true, walkingMetres: null, minutes: null, wheelchair: 'unknown', provenance: d.provenance }]
    const result = planJourney(d, { from: 's-west', to: 's-bay', mode: 'shortest' })
    expect(result.status).toBe('ok')
    const transfer = result.routes[0].transfers[0]
    expect(transfer.kind).toBe('external')
    expect(transfer.fromStationId).toBe('s-river'); expect(transfer.toStationId).toBe('s-science')
    expect(transfer.path).toBeNull()
    expect(transfer.instructions.join(' ')).toContain('重新进站')
    expect(result.routes[0].walkingMetres).toBeNull()
  })
  it('uses direct external walking and external access/egress instead of forcing a train detour', () => {
    const d = basicFixture()
    d.services = [d.services.find(s => s.id === 'l1-outbound')!, d.services.find(s => s.id === 'l3-outbound')!]
    d.externalTransfers = [{ id: 'external-endpoints', fromStationId: 's-river', toStationId: 's-science', bidirectional: true, walkingMetres: null, minutes: null, wheelchair: 'unknown', provenance: d.provenance }]
    for (const [from, to] of [['s-river','s-science'], ['s-science','s-river']]) {
      const result = planJourney(d, { from, to, mode: 'shortest' })
      expect(result.status).toBe('ok')
      expect(result.routes[0].legs).toHaveLength(0)
      expect(result.routes[0].accessTransfers![0].fromStationId).toBe(from)
      expect(result.routes[0].accessTransfers![0].toStationId).toBe(to)
      expect(result.routes[0].walkingMetres).toBeNull()
    }
    const accessible = planJourney(d, { from: 's-river', to: 's-science', mode: 'elevator' })
    expect(accessible.status).toBe('incomplete')
    const access = planJourney(d, { from: 's-river', to: 's-bay', mode: 'shortest' }).routes[0]
    expect(access.legs).toHaveLength(1); expect(access.accessTransfers).toHaveLength(1)
    expect(access.legs[0].fromStationId).toBe('s-science')
    const egress = planJourney(d, { from: 's-west', to: 's-science', mode: 'shortest' }).routes[0]
    expect(egress.legs).toHaveLength(1); expect(egress.egressTransfers).toHaveLength(1)
    expect(egress.legs[0].toStationId).toBe('s-river')
    expect(egress.totalMinutes).toBeNull()
  })
  it('plans the imported real network in both directions with no invented doors or runtime', () => {
    expect(fuzhouDataErrors).toEqual([])
    expect(fuzhouDataset.stations.length).toBeGreaterThan(90)
    for (const [from, to] of [['fz-象峰', 'fz-机场'], ['fz-机场', 'fz-象峰']]) {
      const result = planJourney(fuzhouDataset, { from, to, mode: 'shortest' })
      expect(result.status).toBe('ok')
      expect(result.routes.length).toBeGreaterThan(0)
      expect(result.routes[0].legs.every(l => l.recommendations.length === 0)).toBe(true)
      expect(result.routes[0].totalMinutes).toBeNull()
    }
  })
  it('keeps an in-station alternative when a shorter-transfer route uses an unknown external walk', () => {
    const result = planJourney(fuzhouDataset, { from: 'fz-董屿·福建师大', to: 'fz-滨海中央商务区', mode: 'shortest' })
    const outside = (route: typeof result.routes[number]) => route.transfers.filter(t => t.kind === 'external').length + (route.accessTransfers?.length ?? 0) + (route.egressTransfers?.length ?? 0)
    expect(result.routes.some(route => outside(route) > 0)).toBe(true)
    const indoors = result.routes.filter(route => outside(route) === 0)
    expect(indoors.length).toBeGreaterThan(0)
    expect(indoors.some(route => route.transferCount === 2 && route.legs.length === 3)).toBe(true)
    expect(indoors.every(route => route.walkingMetres === null && route.totalMinutes === null)).toBe(true)
  })
  it('excludes confirmed wheelchair-blocked external links at both endpoints and interchanges', () => {
    const d = basicFixture()
    d.services = [d.services.find(s => s.id === 'l1-outbound')!, d.services.find(s => s.id === 'l3-outbound')!]
    d.externalTransfers = [{ id: 'external-blocked', fromStationId: 's-river', toStationId: 's-science', bidirectional: true, walkingMetres: null, minutes: null, wheelchair: 'blocked', provenance: d.provenance }]
    for (const [from, to] of [['s-river','s-science'], ['s-science','s-river'], ['s-river','s-bay'], ['s-west','s-science'], ['s-west','s-bay']]) {
      expect(planJourney(d, { from, to, mode: 'shortest' }).routes.length).toBeGreaterThan(0)
      const result = planJourney(d, { from, to, mode: 'elevator' })
      expect(result.status).toBe('unreachable')
      expect(result.routes).toHaveLength(0)
    }
  })
})
