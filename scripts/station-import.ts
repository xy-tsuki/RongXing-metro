import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadDataset } from '../src/core/validation'
import { mergeStationPatch, parseStationCsv } from '../src/maintenance/station-patch'
import type { StationPatch } from '../src/maintenance/station-patch'

const [datasetPath, patchPath, outputPath] = process.argv.slice(2)
if (!datasetPath || !patchPath || !outputPath) {
  console.error('用法: npx tsx scripts/station-import.ts <线网.json> <单站.csv或.json> <合并副本.json>')
  process.exit(1)
}
try {
  if ([datasetPath, patchPath].some(path => resolve(path) === resolve(outputPath))) throw new Error('输出文件必须与输入不同，先生成可检查的合并副本。')
  const dataset = loadDataset(JSON.parse(readFileSync(datasetPath, 'utf8').replace(/^\uFEFF/, '')))
  const raw = readFileSync(patchPath, 'utf8').replace(/^\uFEFF/, '')
  const patch = /\.csv$/i.test(patchPath) ? parseStationCsv(raw) : JSON.parse(raw) as StationPatch
  const result = mergeStationPatch(dataset, patch)
  if (!result.data) throw new Error(result.errors.join('\n'))
  writeFileSync(outputPath, JSON.stringify(result.data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  console.log(result.summary.join('\n'))
  console.log(`已输出副本：${outputPath}`)
} catch (e) { console.error((e as Error).message); process.exitCode = 1 }
