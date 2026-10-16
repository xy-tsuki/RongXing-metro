import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv, tableNames } from '../scripts/data-csv'
import { demoDataset } from '../src/data/demo'
describe('editable CSV ingestion', () => {
  it('roundtrips every dataset table including nested JSON, booleans and numeric weights', () => {
    for (const table of tableNames) {
      const records = demoDataset[table] as unknown as Record<string, unknown>[]
      expect(parseCsv(toCsv(records))).toEqual(records)
    }
  })
  it('preserves numeric-looking ids and handles quoted commas/newlines/quotes', () => {
    const rows = [{ id: '001', name: '站名,"测试"\n第二行', level: -2, bidirectional: false }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })
  it('roundtrips unknown measurements and exports empty real indoor tables', () => {
    const rows = [{ id: 'null', name: 'null', doorsKnown: false, longitudinalMetres: null, positions: [] }]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
    expect(parseCsv(toCsv([], ['id', 'stationId', 'level']))).toEqual([])
  })
  it('rejects incomplete quoting, row lengths and duplicated headers', () => {
    expect(() => parseCsv('id,name\n"a,b')).toThrow('引号')
    expect(() => parseCsv('id,name\na,b,c')).toThrow('列数')
    expect(() => parseCsv('id,id\na,b')).toThrow('表头')
  })
})
