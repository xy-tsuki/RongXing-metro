import { describe, expect, it } from 'vitest'
import { facilityEntryUpdate } from '../src/maintenance/facility-entry'
import type { FacilityEntry } from '../src/maintenance/facility-entry'

const draft: FacilityEntry = { mode:'quick', rowKey:'["station","direction"]', type:'楼梯', doors:'2:1;2:2', escalator:'是', group:3, facilityId:'L1', nearestExit:'', description:'' }
describe('collection facility identity and staircase attachments', () => {
  it('does not send stale staircase properties when collecting a lift', () => {
    const entry=facilityEntryUpdate({...draft,type:'电梯'})
    expect(entry).toEqual({entity:'rows',key:draft.rowKey,values:{电梯对应车厢车门:'2:1;2:2'}})
    const detailed=facilityEntryUpdate({...draft,type:'电梯',mode:'detail'})
    expect(detailed.values.类型).toBe('电梯')
    expect(detailed.values).not.toHaveProperty('上行扶梯')
    expect(detailed.key).toBe(`${draft.rowKey}/L1`)
  })
  it('binds the escalator observation to the chosen staircase group', () => {
    const entry=facilityEntryUpdate(draft)
    expect(entry.values).toEqual({楼梯3对应车厢车门:'2:1;2:2','3是否有上行扶梯':'是'})
    expect(facilityEntryUpdate({...draft,mode:'detail'}).values.上行扶梯).toBe('是')
  })
  it('allows a staircase attachment observation while keeping the unknown door unmapped', () => {
    const entry=facilityEntryUpdate({...draft,doors:''})
    expect(entry.values).toEqual({'3是否有上行扶梯':'是'})
    expect(()=>facilityEntryUpdate({...draft,doors:'',escalator:'未知'})).toThrow('至少填写')
  })
  it('rejects unsupported types, invalid staircase groups and missing detail identity', () => {
    expect(()=>facilityEntryUpdate({...draft,type:'扶梯' as FacilityEntry['type']})).toThrow('楼梯或电梯')
    for(const group of [0,4,1.5]) expect(()=>facilityEntryUpdate({...draft,group})).toThrow('第1至第3组')
    expect(()=>facilityEntryUpdate({...draft,mode:'detail',facilityId:' '})).toThrow('稳定设施编号')
  })
})
