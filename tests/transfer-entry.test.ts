import { describe, it, expect } from 'vitest'
import network from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { createCatalog, rowKey, validateUpdate, compareUpdates } from '../src/maintenance/catalog'
import { emptyTransferRoutes, transferEntryUpdates, transferRouteValues, transferWalkingText, hasWalkingFields } from '../src/maintenance/transfer-entry'

const state = createCatalog(network as MetroDataset)
const identity = Object.keys(state.rows).find(key => state.rows[key].换乘线路1)!
const [stationId, serviceId] = JSON.parse(identity)
const from = state.dataset.services.find(s => s.id === serviceId)!
const target = state.dataset.services.find(s => s.lineId !== from.lineId && s.stops.some(p => p.stationId === stationId))!
describe('direction-specific transfer collection without invented measurements', () => {
  it('renders the selected three-step format and retains the chosen destination direction',()=>{
    const route=emptyTransferRoutes()[0];route.metres='120'
    Object.assign(route.walk!,{startFacility:'A1扶梯',startMove:'上楼',guideLine:'5号线',special:'经过连廊后左转',endFacility:'C1楼梯',endMove:'下楼',side:'右侧'})
    expect(transferWalkingText(route,{line:'5号线',direction:'京溪'})).toBe('下车后，乘坐A1扶梯上楼，寻找5号线换乘指引。\n跟随指引步行120米，经过连廊后左转。\n最后乘C1楼梯下楼，向右侧进入5号线（往京溪）站台。')
    route.walk!.special=''
    expect(transferWalkingText(route)).toContain('跟随指引步行120米。')
    expect(transferWalkingText(route)).not.toContain('米，。')
    const routes=emptyTransferRoutes();Object.assign(routes[0],route)
    const detail=transferEntryUpdates(state,identity,target.id,routes).at(-1)!
    expect(detail.values.快速描述).toContain(`（往${target.direction}）站台`)
    expect(detail.values.快速描述).not.toContain('候车门位')
  })
  it('keeps incomplete steps explicit and does not submit the blank template as new evidence',()=>{
    const route=emptyTransferRoutes()[0]
    expect(hasWalkingFields(route)).toBe(false);expect(transferRouteValues(route).description).toBe('')
    expect(transferWalkingText(route)).toContain('[起始设施待核实]')
    expect(transferWalkingText(route)).not.toContain('0米')
    route.walk!.startFacility='电梯E1'
    const value=transferRouteValues(route)
    expect(value.metric).toBe('');expect(value.description).toContain('电梯E1[升降方向待核实]')
    expect(value.description).not.toContain('上楼')
    route.walk!.startMove='向上'
    expect(()=>transferRouteValues(route)).toThrow('上楼或下楼')
  })
  it('keeps a single known measure in evidence, never zero-fills the unknown one', () => {
    const routes = emptyTransferRoutes()
    routes[0].metres = '120'
    expect(transferRouteValues(routes[0])).toEqual({ metric: '', description: '已测距离：120米；耗时未知' })
    routes[0].metres = ''; routes[0].minutes = '2.5'
    expect(transferRouteValues(routes[0])).toEqual({ metric: '', description: '已测耗时：2.5分钟；距离未知' })
  })
  it('writes the legacy paired metric and direction-specific door/step evidence, leaving empty routes untouched', () => {
    const routes = emptyTransferRoutes()
    Object.assign(routes[0], { metres: '120', minutes: '2.5', fromDoors: '2:1;2:2', description: '右转 → A1楼梯 → 换乘站台' })
    const updates = transferEntryUpdates(state, identity, target.id, routes)
    expect(updates.every(u => validateUpdate(state, u).length === 0)).toBe(true)
    const detail = updates.find(u => u.entity === 'transfers')!
    expect(detail.key).toBe(`${identity}/${target.id}`)
    expect(detail.values.快速路程时间).toBe('120,2.5')
    expect(detail.values.快速描述).toContain('下车门位：2:1;2:2\n右转')
    expect(detail.values.快速描述).not.toContain('候车门位')
    expect(detail.values).not.toHaveProperty('扶梯描述')
    expect(detail.values).not.toHaveProperty('无障碍路程时间')
    const previous = structuredClone(state)
    previous.transfers[detail.key] = { ...detail.values, 无障碍描述: '已采集的电梯走法' }
    expect(compareUpdates(previous, updates).some(c => c.field === '无障碍描述')).toBe(false)
  })
  it('rejects invalid measurements, door syntax, unsupported targets and empty evidence', () => {
    const routes = emptyTransferRoutes()
    expect(() => transferEntryUpdates(state, identity, target.id, routes)).toThrow('至少填写')
    for (const value of ['-1', 'abc', 'Infinity', '1e3']) {
      routes[0].metres = value
      expect(() => transferEntryUpdates(state, identity, target.id, routes)).toThrow('数字')
    }
    routes[0].metres = '0'; routes[0].minutes = '0'
    expect(() => transferEntryUpdates(state, identity, target.id, routes)).toThrow('大于0')
    routes[0].minutes = '1'; routes[0].fromDoors = '2:1;2:1'
    expect(() => transferEntryUpdates(state, identity, target.id, routes)).toThrow('重复')
    routes[0].fromDoors = ''
    expect(() => transferEntryUpdates(state, identity, from.id, routes)).toThrow('目标线路')
  })
  it('keeps three-line targets and out-of-station transfers separate instead of merging station names', () => {
    const routes = emptyTransferRoutes(); routes[2].description = '电梯连接情况待核实'
    const crowded = structuredClone(state)
    crowded.rows[identity].换乘线路1 = '已占用1'; crowded.rows[identity].换乘线路2 = '已占用2'
    expect(transferEntryUpdates(crowded, identity, target.id, routes).map(u => u.entity)).toEqual(['transfers'])
    const external = state.dataset.externalTransfers!.find(t => t.bidirectional)!
    const a = state.dataset.services.find(s => s.stops.some(p => p.stationId === external.fromStationId))!
    const b = state.dataset.services.find(s => s.lineId !== a.lineId && s.stops.some(p => p.stationId === external.toStationId))!
    const updates = transferEntryUpdates(state, rowKey(external.fromStationId, a.id), b.id, routes)
    expect(updates.every(u => validateUpdate(state, u).length === 0)).toBe(true)
    expect(updates.at(-1)!.values.rowKey).toBe(rowKey(external.fromStationId, a.id))
  })
  it.skipIf(Number(process.versions.node.split('.')[0]) < 22)('retains partial evidence through pending review, backup and Excel roundtrip in an isolated database', async () => {
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { MaintenanceStore } = await import('../scripts/maintenance/store')
    const { MaintenanceService } = await import('../scripts/maintenance/service')
    const { readWorkbook } = await import('../scripts/maintenance/workbook')
    const directory = mkdtempSync(join(tmpdir(), 'rongxing-transfer-'))
    const store = new MaintenanceStore(join(directory, 'rongxing.sqlite'), state)
    try {
      const service = new MaintenanceService(store), routes = emptyTransferRoutes()
      Object.assign(routes[0], { metres: '120', fromDoors: '2:1', description: '合成验收记录，非现场资料' })
      Object.assign(routes[0].walk!,{startFacility:'合成电梯E1',startMove:'上楼',guideLine:'合成现场线路标识',endFacility:'合成电梯E2',endMove:'下楼',side:'左'})
      const updates = transferEntryUpdates(state, identity, target.id, routes)
      const batch = service.stage(updates, '隔离模板验收', '2026-10-18', Buffer.from(JSON.stringify(updates)))
      expect(batch.status).toBe('pending')
      expect(store.read()).toEqual(state)
      const result = service.review(batch.id, { revision: 0, accept: batch.changes.map(c => c.id), reject: [], actor: 'test', note: '仅隔离测试' })
      expect(existsSync(result.backup.path)).toBe(true)
      expect(store.read().dataset).toEqual(state.dataset)
      const parsed = await readWorkbook(await service.exportWorkbook(), store.read())
      expect(compareUpdates(store.read(), parsed.updates)).toEqual([])
      expect(store.read().transfers[`${identity}/${target.id}`].快速描述).toContain('耗时未知')
      expect(store.read().transfers[`${identity}/${target.id}`].快速描述).toContain('下车后，乘坐合成电梯E1上楼')
    } finally { store.close(); rmSync(directory, { recursive: true }) }
  })
})
