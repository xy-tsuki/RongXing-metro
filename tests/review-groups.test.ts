import { describe, expect, it } from 'vitest'
import type { FieldChange } from '../src/maintenance/catalog'
import { reviewGroups, reviewValue } from '../src/maintenance/review-groups'

const change = (id: string, entity: FieldChange['entity'], key: string, field: string, kind: FieldChange['kind'] = 'new'): FieldChange => ({ id, entity, key, field, before: '', after: 'x', kind })
describe('review presentation', () => {
  it('groups related edits without losing field identities, conflict or prior decisions', () => {
    const edits = [change('1','facilities','["s","d"]/楼梯1','rowKey'), change('2','facilities','["s","d"]/楼梯1','车门'),
      change('3','facilities','["s","d"]/楼梯1','上行扶梯','conflict'), change('4','facilities','["s","d"]/楼梯2','车门'),
      {...change('5','facilities','["s","d"]/楼梯1','描述'),decision:'accepted' as const}]
    const groups = reviewGroups(edits)
    expect(groups.map(group => group.changes.map(c => c.id))).toEqual([['1','2','3'],['4']])
    expect(groups[0].changes[2].kind).toBe('conflict')
  })
  it('separates stair groups and transfer slots, preserving source fields', () => {
    const groups = reviewGroups([change('1','rows','station','楼梯1对应车厢车门'), change('2','rows','station','1是否有上行扶梯'),
      change('3','rows','station','楼梯2对应车厢车门'), change('4','rows','station','换乘描述1（快速）')])
    expect(groups.map(g => [g.title,g.changes.length])).toEqual([['楼梯 1',2],['楼梯 2',1],['换乘 1',1]])
  })
  it('formats only recognized door and distance values without inventing unknown information', () => {
    expect(reviewValue('车门','2:1;2:2')).toBe('2车1门、2车2门')
    expect(reviewValue('快速路程时间','120,3')).toBe('120 米 · 3 分钟')
    expect(reviewValue('车门','待确认')).toBe('待确认')
    expect(reviewValue('车门','')).toBe('未填写')
  })
})
