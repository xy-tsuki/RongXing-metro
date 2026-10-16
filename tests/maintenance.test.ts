import { describe, expect, it } from 'vitest'
import { demoDataset } from '../src/data/demo'
import { fuzhouDataset } from '../src/data/fuzhou'
import { planJourney } from '../src/core/planner'
import { validateDataset } from '../src/core/validation'
import type { MetroDataset } from '../src/core/types'
import { singleStationExample } from '../src/maintenance/example'
import { emptyStationPatch, exportStationTemplate, mergeStationPatch, parseStationCsv, stationPatchToCsv } from '../src/maintenance/station-patch'
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

describe('personal single-station entry', () => {
  it('rejects rebinding an existing door across direction without inheriting old surveyed paths', () => {
    const p = emptyStationPatch(fuzhouDataset, '福州火车站')
    p.provenance = { kind: 'survey', source: 'forward test survey', recordedAt: '2026-10-16' }
    p.nodes = [{ label: 'H', level: -1, kind: 'concourse', knowledge: 'confirmed' }, { label: 'D', line: '1号线', direction: '三江口', level: -1, kind: 'door', car: 2, door: 1, knowledge: 'confirmed' }]
    p.paths = [{ from: 'D', to: 'H', kind: 'walk', metres: 5, seconds: 5, stairCount: 0, wheelchair: 'confirmed', bidirectional: true, knowledge: 'confirmed' }]
    const forward = mergeStationPatch(fuzhouDataset, p)
    expect(forward.errors).toEqual([])
    const original = JSON.stringify(forward.data)
    const q = emptyStationPatch(forward.data!, '福州火车站')
    q.provenance = { kind: 'survey', source: 'reverse door only NO path survey', recordedAt: '2026-10-16' }
    q.nodes = [{ ...p.nodes[1], direction: '象峰' }]
    const rejected = mergeStationPatch(forward.data!, q)
    expect(rejected.data === null).toBe(true)
    expect(rejected.errors.join(' ')).toContain('归属')
    expect(JSON.stringify(forward.data)).toBe(original)
    const reverse = planJourney(forward.data!, { from: forward.data!.stations.find(s => s.name === '斗门')!.id, to: forward.data!.stations.find(s => s.name === '福州火车站')!.id, mode: 'shortest' })
    expect(reverse.routes.length).toBeGreaterThan(0)
    expect(reverse.routes.flatMap(r => r.legs.flatMap(l => l.recommendations))).toEqual([])
  })
  it('rejects silently replacing a mapped car-door with a new alias or changing a door identity', () => {
    const base = mergeStationPatch(demoDataset, singleStationExample).data!
    const original = JSON.stringify(base)
    for (const mutate of [
      (n: typeof singleStationExample.nodes[number]) => { n.label = '全新别名占用已有门位' },
      (n: typeof singleStationExample.nodes[number]) => { n.car = 1 },
      (n: typeof singleStationExample.nodes[number]) => { n.kind = 'facility'; delete n.car; delete n.door },
    ]) {
      const q = emptyStationPatch(base, '缺测站'); q.provenance = clone(singleStationExample.provenance)
      q.nodes = [clone(singleStationExample.nodes[3])]; mutate(q.nodes[0])
      const rejected = mergeStationPatch(base, q)
      expect(rejected.data === null).toBe(true); expect(rejected.errors.length).toBeGreaterThan(0)
      expect(JSON.stringify(base)).toBe(original)
    }
    const valid = emptyStationPatch(base, '缺测站'); valid.provenance = clone(singleStationExample.provenance); valid.nodes = [clone(singleStationExample.nodes[3])]
    expect(mergeStationPatch(base, valid).errors).toEqual([])
  })
  it('rejects two aliases for the same new direction-specific door in one patch', () => {
    const p = emptyStationPatch(fuzhouDataset, '福州火车站')
    p.provenance = { kind: 'survey', source: 'duplicate alias fixture', recordedAt: '2026-10-16' }
    const door = { label: 'A', line: '1号线', direction: '三江口', level: -1, kind: 'door' as const, car: 2, door: 1, knowledge: 'confirmed' as const }
    p.nodes = [door, { ...door, label: 'B' }]
    expect(mergeStationPatch(fuzhouDataset, p).data === null).toBe(true)
  })
  it('generates a station-scoped blank CSV without inventing doors or facilities', () => {
    const text = exportStationTemplate(demoDataset, '缺测站'), patch = parseStationCsv(text)
    expect(patch.station).toBe('缺测站')
    expect(patch.nodes).toEqual([]); expect(patch.paths).toEqual([])
    expect(patch.provenance.source).toBe('')
    expect(mergeStationPatch(demoDataset, patch).errors.length).toBeGreaterThan(0)
  })
  it('fills template → CSV import → validates/merges → updates recommendations from observed paths', () => {
    const before = planJourney(demoDataset, { from: 's-north', to: 's-unknown', mode: 'shortest' })
    expect(before.routes[0]?.legs.at(-1)?.recommendations ?? []).toEqual([])
    const template = parseStationCsv(exportStationTemplate(demoDataset, '缺测站'))
    Object.assign(template, clone(singleStationExample)) // the same fields filled by the local form
    const imported = parseStationCsv(stationPatchToCsv(template))
    const result = mergeStationPatch(demoDataset, imported)
    expect(result.errors).toEqual([])
    expect(validateDataset(result.data)).toEqual([])
    const after = planJourney(result.data!, { from: 's-north', to: 's-unknown', mode: 'shortest' })
    expect(after.routes.length).toBeGreaterThan(0)
    expect(after.routes[0].legs.at(-1)!.recommendations.length).toBeGreaterThan(0)
    expect(after.routes[0].legs.at(-1)!.recommendations.every(p => p.car === 2)).toBe(true)
    expect(result.data!.stations.find(s => s.id === 's-unknown')!.indoorData).toBe('partial')
    expect(result.data!.provenance.kind).toBe('demo')
  })
  it('keeps equivalent local positions and changes them when measured distance changes', () => {
    const result = mergeStationPatch(demoDataset, singleStationExample).data!
    const request = { from: 's-north', to: 's-unknown', mode: 'shortest' as const }
    const initial = planJourney(result, request).routes[0].legs.at(-1)!.recommendations
    expect(initial.map(p => `${p.car}:${p.door}`)).toEqual(['2:1', '2:2'])
    const changed = clone(singleStationExample)
    changed.paths[changed.paths.length - 1].metres = 200
    changed.paths[changed.paths.length - 1].seconds = 200
    const updated = mergeStationPatch(result, changed)
    expect(updated.errors).toEqual([])
    const best = planJourney(updated.data!, request).routes[0].legs.at(-1)!.recommendations
    expect(best.map(p => `${p.car}:${p.door}`)).toEqual(['2:1'])
    expect(updated.data!.walkNodes.length).toBe(result.walkNodes.length)
    expect(updated.data!.walkEdges.length).toBe(result.walkEdges.length) // stable upsert, no duplicate edges
  })
  it('saves manual recommendations for comparison without overriding graph recommendations', () => {
    const patch = clone(singleStationExample)
    patch.manualRecommendations[0].positions = [{ car: 3, door: 1 }]
    const result = mergeStationPatch(demoDataset, patch).data!
    expect(result.manualRecommendations?.[0].positions).toEqual([{ car: 3, door: 1 }])
    expect(planJourney(result, { from: 's-north', to: 's-unknown', mode: 'shortest' }).routes[0].legs.at(-1)!.recommendations.every(p => p.car === 2)).toBe(true)
  })
  it('rejects invalid floors, nonexistent references and out-of-range cars atomically', () => {
    const original = JSON.stringify(demoDataset)
    for (const mutate of [
      (p: typeof singleStationExample) => { p.nodes[3].car = 9 },
      (p: typeof singleStationExample) => { p.paths[0].to = '不存在的节点' },
      (p: typeof singleStationExample) => { p.paths[1].kind = 'walk' },
      (p: typeof singleStationExample) => { p.provenance.recordedAt = '2026-02-30' },
    ]) {
      const p = clone(singleStationExample); mutate(p)
      const result = mergeStationPatch(demoDataset, p)
      expect(result.data).toBeNull(); expect(result.errors.length).toBeGreaterThan(0)
      expect(JSON.stringify(demoDataset)).toBe(original)
    }
  })
  it('can submit facilities only; unknown wheelchair passage cannot form a complete elevator route', () => {
    const facilities = emptyStationPatch(demoDataset, '缺测站')
    facilities.provenance = singleStationExample.provenance
    facilities.nodes = singleStationExample.nodes.slice(0, 3)
    const result = mergeStationPatch(demoDataset, facilities)
    expect(result.errors).toEqual([])
    expect(planJourney(result.data!, { from: 's-north', to: 's-unknown', mode: 'elevator' }).routes.every(r => r.granularity !== 'detailed')).toBe(true)
    const uncertain = clone(singleStationExample); uncertain.paths[1].wheelchair = 'unknown'
    const next = mergeStationPatch(demoDataset, uncertain).data!
    expect(planJourney(next, { from: 's-north', to: 's-unknown', mode: 'elevator' }).routes.every(r => r.granularity !== 'detailed' && r.legs.at(-1)!.recommendations.length === 0)).toBe(true)
  })
  it('retains per-record provenance, handles quoted CSV and refuses malformed cells', () => {
    const patch = clone(singleStationExample)
    patch.provenance.source = '本人记录, 第"1"页\n第二行'
    const parsed = parseStationCsv(stationPatchToCsv(patch))
    expect(parsed).toEqual(patch)
    const merged = mergeStationPatch(demoDataset, parsed).data!
    expect(merged.walkNodes.find(n => n.stationId === 's-unknown' && n.label === '演示2号线往缺测站方向 2车1门')!.provenance?.source).toBe(patch.provenance.source)
    expect(() => parseStationCsv('记录类型,名称\n节点,a')).toThrow('模板')
    expect(() => parseStationCsv(stationPatchToCsv(patch) + ',broken')).toThrow()
  })
  it('records only an observed door in a topology-only dataset without inventing a door table', () => {
    const d: MetroDataset = {
      schemaVersion: '1.0', version: 'network-only', city: { id: 'sample-city', name: '单元测试城市' }, description: '仅用于测试单站输入，非福州数据',
      provenance: { kind: 'official', source: '测试线网来源占位，非真实证据', recordedAt: '2026-10-16' },
      stations: [{ id: 'a', name: '起点', indoorData: 'missing', concourseNodeIds: [] }, { id: 'b', name: '终点', indoorData: 'missing', concourseNodeIds: [] }],
      lines: [{ id: 'l', name: '测试线', color: '#123456' }], formations: [{ id: 'f', cars: 6, positions: [], doorsKnown: false, numberingStatus: 'unknown' }],
      platforms: [], walkNodes: [], walkEdges: [], services: [{ id: 's', lineId: 'l', direction: '终点', formationId: 'f', stops: [{ stationId: 'a', platformId: null, minutesFromPrevious: null }, { stationId: 'b', platformId: null, minutesFromPrevious: null }] }],
    }
    const p = emptyStationPatch(d, '终点')
    p.provenance = { kind: 'survey', source: '单元测试输入，不是真实资料', recordedAt: '2026-10-16' }
    p.nodes = [{ label: '已录站厅', level: -1, kind: 'concourse', knowledge: 'confirmed' }, { label: '已录6车9门', line: '测试线', direction: '终点', level: -1, kind: 'door', car: 6, door: 9, knowledge: 'confirmed' }]
    p.paths = [{ from: '已录6车9门', to: '已录站厅', kind: 'walk', metres: 10, seconds: 10, stairCount: 0, wheelchair: 'confirmed', bidirectional: true, knowledge: 'confirmed' }]
    const merged = mergeStationPatch(d, parseStationCsv(stationPatchToCsv(p)))
    expect(merged.errors).toEqual([])
    expect(merged.data!.formations[0].positions).toHaveLength(1)
    expect(merged.data!.formations[0].positions[0].longitudinalMetres).toBeNull()
    expect(merged.data!.formations[0].doorsKnown).toBe(false)
    expect(merged.data!.formations[0].numberingStatus).toBe('unknown')
    expect(merged.data!.platforms).toHaveLength(1)
    expect(merged.data!.services[0].stops[0].platformId).toBeNull()
    const route = planJourney(merged.data!, { from: 'a', to: 'b', mode: 'shortest' }).routes[0]
    expect(route.legs[0].recommendations.map(x => `${x.car}:${x.door}`)).toEqual(['6:9'])
    expect(route.granularity).toBe('partial')
    expect(d.formations[0].positions).toEqual([])
  })
})
