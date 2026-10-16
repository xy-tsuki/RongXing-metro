import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validateDataset } from '../src/core/validation'
import type { MetroDataset } from '../src/core/types'

const data = JSON.parse(readFileSync('src/data/fuzhou-network.json', 'utf8')) as MetroDataset
assert.deepEqual(validateDataset(data), [])
assert.equal(data.stations.length, 102)
assert.equal(new Set(data.stations.map(s => s.id)).size, 102)
assert.equal(data.services.length, 12)
const expected = { 'fz-l1': [25, 6], 'fz-l2': [22, 6], 'fz-l4': [23, 6], 'fz-l5': [20, 6], 'fz-l6': [14, 4], 'fz-f1': [12, 4] }
for (const [lineId, [count, cars]] of Object.entries(expected)) {
  const [forward, reverse] = data.services.filter(s => s.lineId === lineId)
  assert.ok(forward && reverse)
  assert.equal(forward.stops.length, count)
  assert.deepEqual(forward.stops.map(s => s.stationId), reverse.stops.map(s => s.stationId).reverse())
  assert.equal(data.formations.find(f => f.id === forward.formationId)?.cars, cars)
  assert.ok(forward.stops.every(s => s.platformId === null && s.minutesFromPrevious === null))
}
assert.equal(data.platforms.length + data.walkNodes.length + data.walkEdges.length, 0)
assert.ok(data.formations.every(f => f.positions.length === 0 && f.doorsKnown === false && f.numberingStatus === 'unknown'))
assert.ok(data.stations.every(s => s.indoorData === 'missing' && s.concourseNodeIds.length === 0))
assert.ok(!data.stations.some(s => ['莲花', '壶井', '滨海西', '盖山', '莲花山', '青洲', '十八孔闸'].includes(s.name)))
const memberships = (stationId: string) => data.services.filter(s => s.id.endsWith('forward') && s.stops.some(stop => stop.stationId === stationId)).map(s => s.lineId).sort()
assert.deepEqual(memberships('fz-帝封江'), ['fz-f1', 'fz-l4', 'fz-l5'])
assert.deepEqual(memberships('fz-三叉街'), ['fz-l1'])
assert.deepEqual(memberships('fz-三叉街-滨海快线'), ['fz-f1'])
assert.deepEqual(memberships('fz-闽都'), ['fz-f1'])
assert.deepEqual(memberships('fz-水部'), ['fz-l2'])
const interchanges = data.stations.filter(s => memberships(s.id).length > 1)
assert.equal(interchanges.length, 13)
console.log('REAL NETWORK CHECK PASSED: 102 distinct boarding stations / 116 line-stops / 13 indoor interchange stations / 12 directional all-stop services; no fictional doors/platforms/times.')
