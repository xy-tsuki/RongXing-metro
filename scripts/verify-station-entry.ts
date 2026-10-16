import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { loadDataset, planJourney } from '../src/core'
import { mergeStationPatch, parseStationCsv, stationPatchToCsv } from '../src/maintenance/station-patch'

const readData = (path: string) => loadDataset(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')))
const base = readData('src/data/demo-network.json')
const imported = readData(process.argv[2] ?? 'output/verification/station-entry-imported.json')
const request = { from: 's-north', to: 's-unknown', mode: 'elevator' as const }
const doors = (data: typeof base) => planJourney(data, request).routes[0]?.legs.at(-1)?.recommendations.map(p => `${p.car}:${p.door}`) ?? []
assert.deepEqual(doors(base), [])
assert.deepEqual(doors(imported), ['2:1', '2:2'])
const filled = parseStationCsv(readFileSync('data-entry/single-station-demo.csv', 'utf8'))
const door2 = filled.nodes.find(n => n.kind === 'door' && n.door === 2)!
filled.paths.find(p => p.to === door2.label)!.metres = 200
filled.manualRecommendations[0].positions = [{ car: 3, door: 1 }]
const edited = parseStationCsv(stationPatchToCsv(filled))
const result = mergeStationPatch(imported, edited)
assert.deepEqual(result.errors, [])
assert.deepEqual(doors(result.data!), ['2:1'])
const real = readData('src/data/fuzhou-network.json')
assert.equal(real.platforms.length + real.walkNodes.length + real.walkEdges.length, 0)
assert.ok(real.formations.every(f => f.positions.length === 0))
const report = { date: '2026-10-16', scope: '独立合成数据，未写入真实站点', before: doors(base), afterCsvCliImport: doors(imported), afterDistanceChange: doors(result.data!), manualComparison: '3:1 不覆盖算法结果', realIndoorNodes: real.walkNodes.length }
writeFileSync('output/verification/station-entry-flow.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
