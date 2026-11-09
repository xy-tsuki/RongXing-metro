import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const sourcePath = 'src/data/fuzhou-fares.json'
const targetPath = 'src/navigation/fare-display-data.json'
const bytes = readFileSync(sourcePath)
const source = JSON.parse(bytes.toString('utf8'))
const network = JSON.parse(readFileSync('src/data/fuzhou-network.json', 'utf8'))
const stations: string[] = [...new Set<string>(source.pairs.flatMap((pair: any) => [pair.stationIdA, pair.stationIdB]))].sort()
if (stations.length !== network.stations.length || network.stations.some((station: any) => !stations.includes(station.id))) throw new Error('票价站点与基础线网不一致，拒绝生成展示投影')
const ids = new Map(stations.map((id, i) => [id, i]))
// A readonly UI projection, not a second fare calculator. Prices are copied exactly.
const projection = {
  schemaVersion: 1, cityId: source.city, sourceNetworkVersion: network.version, currency: source.currency, generatedAt: source.generatedAt,
  sourceSha256: createHash('sha256').update(bytes).digest('hex'), ruleSource: source.fareRuleSource,
  distanceSource: 'https://zh.wikipedia.org/wiki/福州地铁车站列表',
  stations,
  // [fromIndex, toIndex, totalYuan, mainAreaYuan, newDistrictYuan]
  quotes: source.pairs.map((pair: any) => [ids.get(pair.stationIdA), ids.get(pair.stationIdB),
    pair.fareYuan, pair.mainAreaFareYuan, pair.newDistrictFareYuan]),
}
const output = JSON.stringify(projection) + '\n'
if (process.argv.includes('--check')) {
  if (readFileSync(targetPath, 'utf8') !== output) throw new Error('票价展示投影已过期，请运行 npx tsx scripts/project-fare-display.ts')
  console.log('Fare display projection matches source')
} else {
  writeFileSync(targetPath, output)
  console.log(JSON.stringify({ file: targetPath, pairs: projection.quotes.length, bytes: Buffer.byteLength(output) }))
}
