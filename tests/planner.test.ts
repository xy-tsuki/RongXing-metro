import { describe, expect, it } from 'vitest'
import { findWalkPath, loadDatasetResult, planJourney, validateDataset } from '../src/core'
import type { MetroDataset, RouteMode } from '../src/core'
import { demoDataset, demoScenarios } from '../src/data/demo'

const clone = () => JSON.parse(JSON.stringify(demoDataset)) as MetroDataset
const direct = (mode: RouteMode = 'shortest', data = demoDataset) => planJourney(data, { from: 's-west', to: 's-river', mode })

describe('dataset import validation', () => {
  it('accepts the versioned synthetic fixture and rejects malformed input safely', () => {
    expect(validateDataset(demoDataset)).toEqual([])
    expect(validateDataset(null)).not.toEqual([])
    expect(validateDataset({ schemaVersion: 'wrong' })).not.toEqual([])
    expect(planJourney({} as MetroDataset, { from: 'a', to: 'b', mode: 'elevator' }).status).toBe('invalid')
  })
  it('offers a nonthrowing loader result for visible UI import errors', () => {
    const valid = loadDatasetResult(demoDataset)
    expect(valid.data).toBe(demoDataset)
    expect(valid.errors).toEqual([])
    for (const input of [null, {}, { stations: [null] }]) {
      const invalid = loadDatasetResult(input)
      expect(invalid.data).toBeNull()
      expect(invalid.errors.length).toBeGreaterThan(0)
    }
  })
  it('rejects duplicate ids, missing mappings, negative weights and vertical walking', () => {
    const d = clone()
    d.walkNodes.push(d.walkNodes[0])
    expect(validateDataset(d).join(' ')).toContain('重复')
    const noDoor = clone(); delete noDoor.platforms[0].doorNodes.p1
    expect(validateDataset(noDoor).join(' ')).toContain('车门映射')
    const invalid = clone(); invalid.walkEdges[0].metres = -1; invalid.walkEdges[0].kind = 'walk'
    expect(validateDataset(invalid).join(' ')).toContain('跨楼层')
    expect(validateDataset(invalid).join(' ')).toContain('属性无效')
  })
  it('diagnoses malformed nested records, missing provenance dates and cross-station walking without throwing', () => {
    for (const mutate of [
      (d: any) => { d.formations[0].positions = [null] },
      (d: any) => { d.services[0].stops = [null, null] },
      (d: any) => { d.platforms[0].doorNodes = null },
      (d: any) => { delete d.provenance.recordedAt },
      (d: any) => { d.stations[0].name = { bad: true } },
    ]) {
      const d = clone(); mutate(d)
      expect(() => validateDataset(d)).not.toThrow()
      expect(validateDataset(d).length).toBeGreaterThan(0)
    }
    const crossStation = clone(); crossStation.walkEdges[0].to = 's-bay:hall'
    expect(validateDataset(crossStation).join(' ')).toContain('节点无效')
  })
})

describe('service routes and door optimization', () => {
  it('permits changing between distinct services on the same line', () => {
    const d = clone()
    const service = d.services.find(s => s.id === 'l1-outbound')!
    d.services = [
      { ...service, id: 'l1-west-shuttle', stops: service.stops.slice(0, 2) },
      { ...service, id: 'l1-river-shuttle', stops: service.stops.slice(1).map((stop, index) => ({ ...stop, minutesFromPrevious: index === 0 ? 0 : stop.minutesFromPrevious })) },
    ]
    expect(validateDataset(d)).toEqual([])
    const result = direct('shortest', d)
    expect(result.status).toBe('ok')
    expect(result.routes[0].transferCount).toBe(1)
    expect(result.routes[0].legs.map(leg => leg.serviceId)).toEqual(['l1-west-shuttle', 'l1-river-shuttle'])
    expect(result.routes[0].legs.map(leg => leg.lineId)).toEqual(['l1', 'l1'])
    expect(result.routes[0].transfers[0].stationId).toBe('s-central')
  })
  it('plans direct, one-transfer and multi-transfer journeys from the same graph', () => {
    for (const [id, transferCount] of [['direct', 0], ['one-transfer', 1], ['multi-transfer', 2]] as const) {
      const scenario = demoScenarios.find(s => s.id === id)!
      const result = planJourney(demoDataset, scenario)
      expect(result.status).toBe('ok')
      expect(result.routes[0].transferCount).toBe(transferCount)
      expect(result.routes[0].legs.length).toBe(transferCount + 1)
      expect(result.routes[0].transfers.length).toBe(transferCount)
      if (id === 'multi-transfer') expect(result.routes[0].doorCombinations[0].positions.map(position => position.car)).toEqual([1, 2, 3])
    }
  })
  it('returns multiple globally equivalent doors, not one arbitrarily chosen door', () => {
    const route = direct().routes[0]
    expect(route.legs[0].recommendations.map(p => p.positionId)).toEqual(['p1', 'p2'])
    expect(route.doorCombinations.length).toBe(2)
    expect(route.walkingMetres).toBe(44)
    expect(route.originPath!.nodes[0]).toBe('s-west:hall')
    expect(route.destinationPath!.nodes.at(-1)).toBe('s-river:hall')
    expect(route.confidence).toBe('demo')
  })
  it('uses directional platforms and keeps each chosen door position fixed while riding', () => {
    const reverse = planJourney(demoDataset, { from: 's-river', to: 's-west', mode: 'shortest' }).routes[0]
    expect(reverse.legs[0].direction).toBe('西门')
    expect(reverse.legs[0].recommendations.map(p => p.positionId)).toEqual(['p5', 'p6'])
    const route = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'shortest' }).routes[0]
    for (const combination of route.doorCombinations) {
      route.legs.forEach((leg, i) => {
        const service = demoDataset.services.find(s => s.id === leg.serviceId)!
        const start = demoDataset.platforms.find(p => p.id === service.stops.find(s => s.stationId === leg.fromStationId)!.platformId)!
        const end = demoDataset.platforms.find(p => p.id === service.stops.find(s => s.stationId === leg.toStationId)!.platformId)!
        const before = i === 0 ? combination.originPath : combination.transferPaths[i - 1]
        const after = i === route.legs.length - 1 ? combination.destinationPath : combination.transferPaths[i]
        expect(before.nodes.at(-1)).toBe(start.doorNodes[combination.positions[i].positionId])
        expect(after.nodes[0]).toBe(end.doorNodes[combination.positions[i].positionId])
      })
    }
  })
  it('recomputes recommendations when facility geometry changes, without changing the algorithm', () => {
    const d = clone()
    for (const edge of d.walkEdges) {
      const doorId = edge.to.startsWith('s-river:') && edge.to.match(/:p([1-6])$/)?.[1]
      if (edge.kind === 'walk' && doorId) { edge.metres = ['5', '6'].includes(doorId) ? 0 : 150; edge.seconds = Math.max(1, edge.metres) }
    }
    expect(validateDataset(d)).toEqual([])
    expect(direct('shortest', d).routes[0].legs[0].recommendations.map(p => p.positionId)).toEqual(['p5', 'p6'])
  })
  it('compares alternate transfer schemes and excludes excessive ride-time detours', () => {
    const request = { from: 's-west', to: 's-bay', mode: 'shortest' as const }
    const result = planJourney(demoDataset, request)
    expect(result.routes).toHaveLength(2)
    expect(result.routes.every(route => route.transferCount === 2)).toBe(true)
    expect(result.routes[0].rideMinutes).toBe(9)
    expect(result.routes.some(r => r.legs.some(l => l.lineId === 'l4'))).toBe(true)
    const slow = clone()
    for (const service of slow.services.filter(s => s.lineId === 'l4')) service.stops[1].minutesFromPrevious = 100
    const filtered = planJourney(slow, request)
    expect(filtered.status).toBe('ok')
    expect(filtered.routes.some(r => r.legs.some(l => l.lineId === 'l4'))).toBe(false)
  })
  it('keeps a feasible direct route when a much faster route exceeds the transfer envelope', () => {
    const d = clone()
    const bay = d.platforms.find(p => p.id === 's-bay:l3:outbound')!
    d.platforms.push({ ...bay, id: 'bay-slow-direct', lineId: 'l1' })
    d.services.push({ id: 'slow-direct', lineId: 'l1', formationId: 'three-car', direction: '海湾', stops: [
      { stationId: 's-west', platformId: 's-west:l1:outbound', minutesFromPrevious: 0 },
      { stationId: 's-bay', platformId: 'bay-slow-direct', minutesFromPrevious: 40 },
    ] })
    expect(validateDataset(d)).toEqual([])
    // A 9-minute route exists, but needs two transfers and lies outside direct+1.
    const result = planJourney(d, { from: 's-west', to: 's-bay', mode: 'shortest' })
    expect(result.status).toBe('ok')
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.routes[0].transferCount).toBe(0)
    expect(result.routes[0].rideMinutes).toBe(40)
  })
  it('supports another city, added station/line and a different formation using data only', () => {
    const d = clone()
    d.city = { id: 'another-city', name: '另一城市' }
    d.formations[0].cars = 5; d.formations[0].positions.forEach(p => { p.car += 2 })
    const templateId = 's-river', newId = 's-new'
    const replace = (id: string) => id.replace(templateId, newId)
    const template = d.stations.find(s => s.id === templateId)!
    d.stations.push({ ...template, id: newId, name: '新增站', concourseNodeIds: template.concourseNodeIds.map(replace) })
    d.walkNodes.push(...d.walkNodes.filter(n => n.stationId === templateId).map(n => ({ ...n, id: replace(n.id), stationId: newId })))
    d.walkEdges.push(...d.walkEdges.filter(e => e.from.startsWith(templateId)).map(e => ({ ...e, id: `new-${e.id}`, from: replace(e.from), to: replace(e.to) })))
    d.platforms.push(...d.platforms.filter(p => p.stationId === templateId).map(p => ({ ...p, id: replace(p.id), stationId: newId, doorNodes: Object.fromEntries(Object.entries(p.doorNodes).map(([key, value]) => [key, replace(value)])) })))
    const outbound = d.services.find(s => s.id === 'l1-outbound')!
    outbound.stops.push({ stationId: newId, platformId: `${newId}:l1:outbound`, minutesFromPrevious: 2 })
    d.lines.push({ id: 'added-line', name: '新增线路', color: '#112233' })
    const stationPlatform = d.platforms.find(p => p.id === `${newId}:l1:outbound`)!
    const riverPlatform = d.platforms.find(p => p.id === 's-river:l1:outbound')!
    // A new line can share physical boarding nodes but must declare its own platform/line identity.
    d.platforms.push({ ...stationPlatform, id: 'new-platform', lineId: 'added-line' }, { ...riverPlatform, id: 'river-new-platform', lineId: 'added-line' })
    d.services.push({ id: 'new-service', lineId: 'added-line', formationId: 'three-car', direction: '新增站', stops: [{ stationId: 's-river', platformId: 'river-new-platform', minutesFromPrevious: 0 }, { stationId: newId, platformId: 'new-platform', minutesFromPrevious: 2 }] })
    expect(validateDataset(d)).toEqual([])
    const route = planJourney(d, { from: 's-west', to: newId, mode: 'shortest' })
    expect(route.status).toBe('ok')
    expect(route.routes[0].legs.at(-1)!.toStationName).toBe('新增站')
    expect(route.routes[0].legs[0].recommendations[0].car).toBe(3)
  })
})

describe('mode objectives and continuous accessibility', () => {
  it('selects different fixed doors for shortest, fewer stairs and elevator-only modes', () => {
    const shortest = direct().routes[0], fewer = direct('few-stairs').routes[0], elevator = direct('elevator').routes[0]
    expect(shortest.legs[0].recommendations.map(p => p.car)).toEqual([1, 1])
    expect(fewer.legs[0].recommendations.map(p => p.car)).toEqual([3, 3])
    expect(elevator.legs[0].recommendations.map(p => p.car)).toEqual([2, 2])
    expect(shortest.stairCount).toBeGreaterThan(0)
    expect(fewer.stairCount).toBe(0)
    expect(elevator.stairCount).toBe(0)
    expect(shortest.walkingMetres).toBeLessThan(fewer.walkingMetres!)
    expect(fewer.walkingMetres).toBeLessThan(elevator.walkingMetres!)
  })
  it('rejects stairs AND escalators on all origin, transfer and destination paths', () => {
    const result = planJourney(demoDataset, { from: 's-west', to: 's-bay', mode: 'elevator' })
    expect(result.status).toBe('ok')
    for (const route of result.routes) for (const c of route.doorCombinations) {
      for (const path of [c.originPath, ...c.transferPaths, c.destinationPath]) {
        expect(path.edges.some(e => e.kind === 'stairs' || e.kind === 'escalator')).toBe(false)
        expect(path.edges.every(e => e.knowledge === 'confirmed')).toBe(true)
        for (let i = 0; i < path.edges.length; i++) {
          const a = demoDataset.walkNodes.find(n => n.id === path.nodes[i])!, b = demoDataset.walkNodes.find(n => n.id === path.nodes[i + 1])!
          if (a.level !== b.level) expect(path.edges[i].kind).toBe('lift')
        }
      }
    }
  })
  it('reports complete-but-no-lift as unreachable and unknown data as incomplete', () => {
    // Fault injection only: the public demonstration contains lifts at every known station.
    const fault = clone()
    fault.walkEdges = fault.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-east:hall'))
    const blocked = planJourney(fault, { from: 's-west', to: 's-east', mode: 'elevator' })
    expect(blocked.status).toBe('unreachable'); expect(blocked.routes).toHaveLength(0)
    const unknown = planJourney(demoDataset, { from: 's-west', to: 's-unknown', mode: 'elevator' })
    expect(unknown.status).toBe('incomplete'); expect(unknown.routes.length).toBeGreaterThan(0)
    expect(unknown.routes.every(route => route.granularity !== 'detailed')).toBe(true)
    expect(planJourney(fault, { from: 's-west', to: 's-east', mode: 'shortest' }).status).toBe('ok')
  })
  it('requires independent wheelchair confirmation on level paths, not only working lifts', () => {
    const blocked = clone()
    for (const edge of blocked.walkEdges) if (edge.kind === 'walk' && edge.from.startsWith('s-west:')) edge.wheelchair = 'blocked'
    expect(validateDataset(blocked)).toEqual([])
    expect(direct('shortest', blocked).status).toBe('ok')
    expect(direct('elevator', blocked).status).toBe('unreachable')
    const unknown = clone()
    for (const edge of unknown.walkEdges) if (edge.kind === 'walk' && edge.from.startsWith('s-west:')) edge.wheelchair = 'unknown'
    expect(direct('shortest', unknown).status).toBe('ok')
    expect(direct('elevator', unknown).status).toBe('incomplete')
    const missing = clone()
    delete (missing.walkEdges[0] as Partial<MetroDataset['walkEdges'][number]>).wheelchair
    expect(validateDataset(missing).join(' ')).toContain('wheelchair')
    expect(direct('elevator', missing).status).toBe('invalid')
  })
  it('cannot claim accessibility when only an origin lift is missing', () => {
    const d = clone()
    d.walkEdges = d.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-west:hall'))
    expect(direct('elevator', d).status).toBe('unreachable')
    expect(direct('few-stairs', d).status).toBe('ok')
  })
  it('finds an accessible alternative when the faster transfer station has no lift', () => {
    const d = clone()
    d.walkEdges = d.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-central:hall'))
    const result = planJourney(d, { from: 's-west', to: 's-bay', mode: 'elevator' })
    expect(result.status).toBe('ok')
    expect(result.routes[0].legs.some(l => l.lineId === 'l4')).toBe(true)
    expect(result.routes[0].transfers.some(t => t.stationId === 's-central')).toBe(false)
  })
  it('allows riding through a previously passed station on an accessible detour', () => {
    const d = clone()
    d.walkEdges = d.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-central:hall'))
    const result = planJourney(d, { from: 's-west', to: 's-north', mode: 'elevator' })
    expect(result.status).toBe('ok')
    const detour = result.routes.find(route => route.legs.map(leg => leg.serviceId).join(',') === 'l1-outbound,l4-outbound,l2-inbound')
    expect(detour).toBeDefined()
    expect(detour!.transfers.map(t => t.stationId)).toEqual(['s-river', 's-science'])
    // The last train passes Central again; its missing lifts are never used.
    expect(detour!.legs[2].toStationId).toBe('s-north')
    expect(detour!.transfers.some(t => t.stationId === 's-central')).toBe(false)
  })
  it('does not let an unused unknown formation prune a confirmed accessible detour', () => {
    const d = clone()
    d.walkEdges = d.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-central:hall'))
    const request = { from: 's-west', to: 's-north', mode: 'elevator' as const }
    expect(planJourney(d, request).status).toBe('ok')
    d.formations.push({ id: 'unrelated-unrecorded', cars: 4, positions: [], doorsKnown: false, numberingStatus: 'unknown' })
    expect(validateDataset(d)).toEqual([])
    const result = planJourney(d, request)
    expect(result.status).toBe('ok')
    expect(result.routes[0].granularity).toBe('detailed')
    expect(result.routes[0].legs.map(l => l.serviceId)).toEqual(['l1-outbound', 'l4-outbound', 'l2-inbound'])
  })
  it('does not revive a confirmed blocked interchange because another candidate touches missing data', () => {
    const d = clone()
    d.services = d.services.filter(service => service.lineId !== 'l4')
    d.walkEdges = d.walkEdges.filter(e => !(e.kind === 'lift' && e.from === 's-central:hall'))
    const result = planJourney(d, { from: 's-west', to: 's-north', mode: 'elevator' })
    expect(result.status).toBe('unreachable')
    expect(result.routes).toHaveLength(0)
  })
  it('allows a confirmed continuous path in partial data and states the optimization limit', () => {
    const d = clone()
    d.stations.find(s => s.id === 's-west')!.indoorData = 'partial'
    const result = direct('elevator', d)
    expect(result.status).toBe('ok')
    expect(result.diagnostics.join(' ')).toContain('未采集路径范围')
  })
  it('respects directed facility operation instead of assuming reverse access', () => {
    const d = clone()
    d.walkEdges.forEach(e => { if (e.kind === 'lift') e.bidirectional = false })
    const platform = d.platforms.find(p => p.id === 's-river:l1:outbound')!
    expect(findWalkPath(d, [platform.doorNodes.p3], ['s-river:hall'], 'elevator')).toBeNull()
    expect(direct('elevator', d).status).toBe('unreachable')
  })
  it('describes vertical travel in the actual traversal direction for reversible facilities', () => {
    const platform = demoDataset.platforms.find(p => p.id === 's-west:l1:outbound')!
    const down = findWalkPath(demoDataset, ['s-west:hall'], [platform.doorNodes.p3], 'elevator')!
    const up = findWalkPath(demoDataset, [platform.doorNodes.p3], ['s-west:hall'], 'elevator')!
    expect(down.instructions.join(' ')).toContain('乘电梯下行至地下1层')
    expect(up.instructions.join(' ')).toContain('乘电梯上行至地面层')
    expect(down.instructions.join(' ')).toContain('接驳步行约40米')
    for (const mode of ['shortest', 'few-stairs'] as const) {
      const chosen = mode === 'shortest' ? 'p1' : 'p5'
      const path = findWalkPath(demoDataset, [platform.doorNodes[chosen]], ['s-west:hall'], mode)!
      expect(path.instructions.join(' ')).toContain(mode === 'shortest' ? '走楼梯上行至地面层' : '乘扶梯上行至地面层')
    }
  })
  it('returns explicit invalid requests and searches without relying on browser APIs', () => {
    expect(planJourney(demoDataset, { from: 's-west', to: 's-west', mode: 'shortest' }).status).toBe('invalid')
    expect(planJourney(demoDataset, { from: 'unknown', to: 's-bay', mode: 'shortest' }).status).toBe('invalid')
    expect(typeof globalThis.window).toBe('undefined')
    expect(direct().status).toBe('ok')
  })
})
