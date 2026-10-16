import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { validateDataset } from '../src/core/validation'
import { parseCsv, tableNames } from './data-csv'
const [source, output] = process.argv.slice(2)
try {
  if (!source || !output) throw new Error('用法: npm run data:import -- <完整JSON或CSV目录> <新的输出JSON路径>')
  if (existsSync(output)) throw new Error('输出文件已存在；为保护已有数据，请使用新的输出文件名')
  let input: unknown
  if (statSync(source).isDirectory()) {
    const metadata = JSON.parse(readFileSync(join(source, 'metadata.json'), 'utf8').replace(/^\uFEFF/, ''))
    input = { ...metadata, ...Object.fromEntries(tableNames.map(table => [table, parseCsv(readFileSync(join(source, `${table}.csv`), 'utf8'))])) }
  } else input = JSON.parse(readFileSync(source, 'utf8').replace(/^\uFEFF/, ''))
  const errors = validateDataset(input)
  if (errors.length) throw new Error(errors.join('\n'))
  writeFileSync(output, JSON.stringify(input, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  console.log(`Validated and imported to ${output}. Switch the app dataset import explicitly after review.`)
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
