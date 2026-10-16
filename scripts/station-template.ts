import { readFileSync, writeFileSync } from 'node:fs'
import { loadDataset } from '../src/core/validation'
import { exportStationTemplate } from '../src/maintenance/station-patch'

const [datasetPath, stationName, outputPath] = process.argv.slice(2)
if (!datasetPath || !stationName || !outputPath) {
  console.error('用法: npx tsx scripts/station-template.ts <线网.json> <站名> <输出.csv>')
  process.exit(1)
}
try {
  const data = loadDataset(JSON.parse(readFileSync(datasetPath, 'utf8').replace(/^\uFEFF/, '')))
  writeFileSync(outputPath, exportStationTemplate(data, stationName), { encoding: 'utf8', flag: 'wx' })
  console.log(`已生成 ${stationName} 空模板：${outputPath}。不包含任何推测设施或门号。`)
} catch (e) { console.error((e as Error).message); process.exitCode = 1 }
