import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadDataset } from '../src/core/validation'
import { toCsv, tableNames } from './data-csv'
const [source = 'src/data/demo-network.json', output] = process.argv.slice(2)
try {
  if (!output) throw new Error('用法: npx tsx scripts/data-export.ts <完整JSON> <新的CSV目录>')
  if (existsSync(output)) throw new Error('输出目录已存在，请使用新的目录名')
  const data = loadDataset(JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, '')))
  mkdirSync(output, { recursive: true })
  const metadata = Object.fromEntries(Object.entries(data).filter(([key]) => !tableNames.includes(key as typeof tableNames[number])))
  writeFileSync(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8')
  const emptyHeaders = { stations: ['id', 'name', 'concourseNodeIds', 'indoorData'], lines: ['id', 'name', 'color'], formations: ['id', 'cars', 'positions'], platforms: ['id', 'stationId', 'lineId', 'level', 'doorNodes'], services: ['id', 'lineId', 'direction', 'formationId', 'stops'], walkNodes: ['id', 'stationId', 'level', 'label', 'kind', 'knowledge'], walkEdges: ['id', 'from', 'to', 'kind', 'metres', 'seconds', 'stairCount', 'knowledge', 'wheelchair', 'bidirectional', 'provenance'] }
  for (const table of tableNames) writeFileSync(join(output, `${table}.csv`), toCsv(data[table] as unknown as Record<string, unknown>[], emptyHeaders[table]), 'utf8')
  console.log(`Exported metadata and ${tableNames.length} editable CSV tables to ${output}`)
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
