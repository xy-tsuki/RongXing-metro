import { describe, expect, it } from 'vitest'
import raw from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { createCatalog, validateUpdate, type Update } from '../src/maintenance/catalog'
import { validatePublicUpdate } from '../src/maintenance/submission-validation'
import { readWorkbook, writeWorkbook } from '../scripts/maintenance/workbook'
const state = createCatalog(raw as MetroDataset), rowKey = Object.keys(state.rows)[0]
const facility = (type: string, extra = {}): Update => ({ entity: 'facilities', key: `${rowKey}/A1`, values: { rowKey, 编号: 'A1', 类型: type, ...extra } })
describe('public facility collection without destructive legacy migration', () => {
  it('accepts stairs with yes/no/unknown, and elevators without an escalator attribute', () => {
    for (const value of ['是', '否', '未知']) expect(validatePublicUpdate(state, facility('楼梯', { 上行扶梯: value }))).toEqual([])
    expect(validatePublicUpdate(state, facility('电梯'))).toEqual([])
  })
  it('rejects standalone escalators and any escalator attribute on elevators, including empty/unknown', () => {
    expect(validatePublicUpdate(state, facility('扶梯')).join()).toContain('仅支持')
    for (const value of ['', '未知', '是', '否', '【清空】']) expect(validatePublicUpdate(state, facility('电梯', { 上行扶梯: value })).join()).toContain('不能包含')
  })
  it('keeps quick elevator and stair updates separate', () => {
    const update: Update = { entity: 'rows', key: rowKey, values: { 电梯对应车厢车门: '1:1' } }
    expect(validatePublicUpdate(state, update)).toEqual([])
    expect(validatePublicUpdate(state, { ...update, values: { ...update.values, '1是否有上行扶梯': '未知' } }).join()).toContain('不能包含')
  })
  it('still validates and roundtrips legacy escalator/elevator fields in administrative Excel', async () => {
    const legacy = createCatalog(raw as MetroDataset)
    for (const [id, type] of [['A1', '扶梯'], ['A2', '电梯']]) {
      const update = { ...facility(type, { 上行扶梯: '未知' }), key: `${rowKey}/${id}` }
      update.values.编号 = id
      expect(validateUpdate(legacy, update)).toEqual([])
      legacy.facilities[update.key] = update.values
    }
    const parsed = await readWorkbook(await writeWorkbook(legacy, 'legacy-test'), legacy)
    expect(parsed.updates.filter(u => u.entity === 'facilities').map(u => [u.values.类型, u.values.上行扶梯])).toEqual([['扶梯', '未知'], ['电梯', '未知']])
  })
})
