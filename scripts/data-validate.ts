import { readFileSync } from 'node:fs'
import { validateDataset } from '../src/core/validation'
import type { MetroDataset } from '../src/core/types'
const path = process.argv[2] ?? 'src/data/fuzhou-network.json'
try {
  const data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as MetroDataset
  const errors = validateDataset(data)
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
  else console.log(`VALID ${data.city.name} ${data.version}: ${data.stations.length} stations / ${data.lines.length} lines / ${data.services.length} directional services / ${data.walkEdges.length} indoor edges; provenance=${data.provenance.kind}`)
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
