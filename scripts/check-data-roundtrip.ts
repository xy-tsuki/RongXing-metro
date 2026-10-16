import { readFileSync } from 'node:fs'
import { deepStrictEqual } from 'node:assert'
const [original, restored] = process.argv.slice(2)
if (!original || !restored) throw new Error('用法: npx tsx scripts/check-data-roundtrip.ts <原JSON> <往返JSON>')
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
deepStrictEqual(read(restored), read(original))
console.log('PASS: complete dataset roundtrip preserves nulls, booleans, empty tables, sources and external transfers.')
