<script setup lang="ts">
import { transitDisplayText } from '../../navigation/line-display'
import OperatorRecord from '../../maintenance/OperatorRecord.vue'
import DoorPositionField from '../../maintenance/DoorPositionField.vue'
import ExitListField from '../../maintenance/ExitListField.vue'
import { collectionDate } from '../../maintenance/collection-fields'
import TransferRouteEditor from '../../maintenance/TransferRouteEditor.vue'
import { staircaseGroups } from '../../maintenance/facility-form'
import DataReleasePanel from '../../maintenance/DataReleasePanel.vue'
import { stationsForCollection } from '../../maintenance/collection-selection'
import { computed, reactive, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Catalog, FieldChange, Update } from '../../maintenance/catalog'
import { transferStationIds } from '../../maintenance/catalog'
import { reviewGroups, reviewValue, type ReviewGroup } from '../../maintenance/review-groups'
import type { Service, Station, Line, ExternalTransfer } from '../../core/types'
import { maintenanceRequest as api, downloadMaintenance } from '../../maintenance/api'
import { facilityTypes, escalatorChoices, facilityEntryUpdate } from '../../maintenance/facility-entry'
import type { CollectionFacilityType } from '../../maintenance/facility-entry'
import { emptyTransferRoutes, transferRouteTypes, transferRouteValues, transferEntryUpdates, transferRouteHasEvidence } from '../../maintenance/transfer-entry'

type Mode = 'quick' | 'detail' | 'transfer' | 'admin'
// Public builds never present a field that could send an admin secret to the public gateway.
const privateAdmin = import.meta.env.DEV && import.meta.env.VITE_PRIVATE_ADMIN === '1'
interface Batch { id: string; revision: number; source: string; recordedAt: string; warnings: string[]; changes: FieldChange[]; status: string }
const mode = ref<Mode>('quick'), busy = ref(false), error = ref(''), message = ref('')
const catalog = ref<{ revision: number; rows: Catalog['rows']; stations: Station[]; lines: Line[]; services: Service[]; externalTransfers?: ExternalTransfer[] } | null>(null)
const catalogState = ref<'loading'|'ready'|'failed'>('loading')
const lineIndex = ref(0), stationIndex = ref(0), directionIndex = ref(0), groupIndex = ref(-1), targetIndex = ref(0), escalatorIndex = ref(0)
const draftGroups = ref<number[]>([])
const groupDrafts = new Map<number, { doors: string; escalator: number }>()
const facilityType = ref<CollectionFacilityType>('楼梯')
const source = ref(''), recordedAt = ref(collectionDate()), doors = ref(''), facilityId = ref(''), nearestExit = ref(''), description = ref('')
const routes = reactive(emptyTransferRoutes())
const activeRoute = ref(0)
const preview = ref(false)
const target = computed(() => targets.value[targetIndex.value])
const transferSummary = computed(() => `${station.value?.name ?? ''} · ${directionLabels.value[directionIndex.value] ?? ''} → ${targetLabels.value[targetIndex.value] ?? '请选择目标方向'}`)
const walkingTarget = computed(() => target.value ? { line: catalog.value?.lines.find(l=>l.id===target.value!.lineId)?.name ?? '', direction:target.value.direction } : undefined)
function routePreview(index: number) { try { return transferRouteValues(routes[index], walkingTarget.value) } catch (e) { return { metric: '', description: (e as Error).message } } }
const adminSection = ref<'review'|'publish'|'tools'>('review')
const adminTool = ref<'excel'|'topology'|'history'|null>(null)
const pendingBatches = computed(() => batches.value.filter(b => b.status === 'pending'))
const actor = ref(''), note = ref(''), batches = ref<Batch[]>([]), selected = ref<Batch | null>(null), accepted = ref<string[]>([]), conflicts = ref(false)
const history = ref<{ id: string; createdAt: string; actor: string; note: string }[]>([]), restoreId = ref(''), restoreConfirm = ref('')
const patchText = ref(''), uploadName = ref('')
const lines = computed(() => catalog.value?.lines ?? [])
const line = computed(() => lines.value[lineIndex.value])
const stations = computed(() => catalog.value ? stationsForCollection(catalog.value, line.value?.id ?? '') : [])
const station = computed(() => stations.value[stationIndex.value])
const directions = computed(() => catalog.value?.services.filter(s => s.lineId === line.value?.id && s.stops.some(p => p.stationId === station.value?.id)) ?? [])
const direction = computed(() => directions.value[directionIndex.value])
const directionLabels = computed(() => directions.value.map(s => `${transitDisplayText(catalog.value?.lines.find(l => l.id === s.lineId)?.name ?? '')} · 往${s.direction}`))
const key = computed(() => JSON.stringify([station.value?.id, direction.value?.id]))
const currentRow = computed(() => catalog.value?.rows[key.value] ?? {})
const groups = computed(() => [...new Set([...staircaseGroups(currentRow.value), ...draftGroups.value])].sort())
function rememberGroup() {
  if (groupIndex.value >= 0) groupDrafts.set(groupIndex.value + 1, { doors: doors.value, escalator: escalatorIndex.value })
}
function selectGroup(group: number) {
  rememberGroup()
  groupIndex.value = group - 1
  const draft = groupDrafts.get(group)
  doors.value = draft?.doors ?? currentRow.value[`楼梯${group}对应车厢车门`] ?? ''
  const escalator = currentRow.value[`${group}是否有上行扶梯`]
  escalatorIndex.value = draft?.escalator ?? (escalator === '是' ? 1 : escalator === '否' ? 2 : 0)
}
function addGroup() {
  const group = [1, 2, 3].find(value => !groups.value.includes(value))
  if (group) { draftGroups.value.push(group); selectGroup(group) }
}
const targets = computed(() => catalog.value?.services.filter(s => s.lineId !== direction.value?.lineId && s.stops.some(p => transferStationIds(catalog.value!, station.value?.id ?? '').has(p.stationId))) ?? [])
const targetLabels = computed(() => targets.value.map(s => `${transitDisplayText(catalog.value?.lines.find(l => l.id === s.lineId)?.name ?? '')} · 往${s.direction}`))
const targetLines = computed(() => catalog.value?.lines.filter(l => targets.value.some(s => s.lineId === l.id)) ?? [])
const targetLineIndex = computed(() => Math.max(0, targetLines.value.findIndex(l => l.id === target.value?.lineId)))
const targetDirections = computed(() => targets.value.filter(s => s.lineId === target.value?.lineId))
const targetDirectionIndex = computed(() => Math.max(0, targetDirections.value.findIndex(s => s.id === target.value?.id)))
function chooseTargetLine(e: any) {
  const line = targetLines.value[choose(e)]
  targetIndex.value = Math.max(0, targets.value.findIndex(s => s.lineId === line?.id))
}
function chooseTargetDirection(e: any) {
  const selected = targetDirections.value[choose(e)]
  targetIndex.value = Math.max(0, targets.value.findIndex(s => s.id === selected?.id))
}
const unresolved = computed(() => selected.value?.changes.filter(c => !c.decision) ?? [])
const groupedChanges = computed(() => reviewGroups(unresolved.value))
const detailedGroups = ref<string[]>([])
const selectedConflicts = computed(() => unresolved.value.filter(c => c.kind === 'conflict' && accepted.value.includes(c.id)).length)
const choose = (e: any) => Number(e.detail.value)
const dateValue = (e: any) => String(e.detail.value)
function chooseFacility(e: any) { const type = facilityTypes[choose(e)]; if (type) facilityType.value = type }
const display = (v: unknown) => v === '' || v === undefined || v === null ? '空 / 未知' : typeof v === 'object' ? JSON.stringify(v) : String(v)
function identityLabel(change: FieldChange) {
  const parent = change.entity === 'rows' ? change.key : change.key.slice(0, change.key.lastIndexOf(']/') + 1)
  const row = catalog.value?.rows[parent]
  return row ? `${row.车站} · ${transitDisplayText(row.所属线路)} · 往${row['运行方向（终点站）']}` : change.key
}
function groupTitle(group: ReviewGroup) {
  if (group.entity === 'facilities') {
    const number = group.changes.find(c => c.field === '编号')?.after ?? group.key.slice(group.key.lastIndexOf('/') + 1)
    const type = group.changes.find(c => c.field === '类型')?.after
    return [type, number].filter(Boolean).join(' · ') || group.title
  }
  if (group.entity === 'transfers') {
    const targetId = group.changes.find(c => c.field === '目标方向ID')?.after ?? group.key.slice(group.key.lastIndexOf('/') + 1)
    const service = catalog.value?.services.find(s => s.id === targetId)
    const name = catalog.value?.lines.find(l => l.id === service?.lineId)?.name
    return service ? `换乘 ${transitDisplayText(name ?? '')} · 往${service.direction}` : '换乘记录'
  }
  return group.title
}
function visibleChanges(group: ReviewGroup) {
  return group.changes.filter(c => c.kind === 'conflict' || !['rowKey','编号','类型','目标方向ID'].includes(c.field))
}
function fieldLabel(field: string) {
  if (field === '车门' || field.includes('对应车厢车门')) return '车厢车门'
  if (field === '上行扶梯' || field.includes('是否有上行扶梯')) return '上行扶梯'
  if (field.includes('最近出入口')) return '最近出入口'
  return field
}
function groupState(group: ReviewGroup) {
  const safe = group.changes.filter(c => c.kind !== 'conflict')
  const count = safe.filter(c => accepted.value.includes(c.id)).length
  return { safe, count, all: safe.length > 0 && count === safe.length }
}
function toggleGroup(group: ReviewGroup) {
  const state = groupState(group), ids = new Set(state.safe.map(c => c.id))
  accepted.value = state.all ? accepted.value.filter(id => !ids.has(id)) : [...new Set([...accepted.value, ...ids])]
}
function toggleDetails(id: string) { detailedGroups.value = detailedGroups.value.includes(id) ? detailedGroups.value.filter(item => item !== id) : [...detailedGroups.value, id] }
watch(lineIndex, () => { stationIndex.value = 0; directionIndex.value = 0; targetIndex.value = 0; clearFields() })
watch(stationIndex, () => { directionIndex.value = 0; targetIndex.value = 0; clearFields() })
watch(directionIndex, () => { targetIndex.value = 0; clearFields() })
watch(facilityType, (_, previous) => { if (previous === '楼梯' && mode.value === 'quick') rememberGroup(); groupIndex.value = -1; escalatorIndex.value = 0; doors.value = facilityType.value === '电梯' && mode.value === 'quick' ? currentRow.value.电梯对应车厢车门 ?? '' : '' })
watch(targetIndex, clearRoutes)
function clearRoutes() { routes.splice(0, routes.length, ...emptyTransferRoutes()); preview.value = false; activeRoute.value = 0 }
function clearFields() { groupIndex.value = -1; draftGroups.value = []; groupDrafts.clear(); escalatorIndex.value = 0; doors.value = facilityType.value === '电梯' && mode.value === 'quick' ? currentRow.value.电梯对应车厢车门 ?? '' : ''; facilityId.value = ''; nearestExit.value = ''; description.value = ''; clearRoutes() }
async function action(fn: () => Promise<void>) {
  if (busy.value) return
  error.value = ''; message.value = ''; busy.value = true
  try { await fn() } catch (e) { error.value = (e as Error).message } finally { busy.value = false }
}
async function loadCatalog() {
  catalogState.value='loading'
  try { catalog.value = await api('/api/catalog'); catalogState.value='ready' }
  catch(e) { catalogState.value='failed';throw e }
}
onLoad(options => { if (['quick', 'detail', 'transfer', ...(privateAdmin ? ['admin'] : [])].includes(options?.mode ?? '')) mode.value = options!.mode as Mode; action(mode.value === 'admin' ? loadAdmin : loadCatalog) })
function setMode(value: Mode) { mode.value = value; clearFields(); error.value = ''; message.value = ''; selected.value = null; if (value === 'admin') void action(loadAdmin) }
async function submit() { await action(async () => {
  if (!catalog.value || !direction.value) throw new Error('先连接服务并选择车站与方向')
  if (!source.value.trim() || !recordedAt.value) throw new Error('请填写来源和采集日期')
  const updates: Update[] = []
  if (mode.value === 'quick' || mode.value === 'detail') {
    updates.push(facilityEntryUpdate({ mode: mode.value, rowKey: key.value, type: facilityType.value,
      doors: doors.value, escalator: escalatorChoices[escalatorIndex.value], group: groupIndex.value + 1,
      facilityId: facilityId.value, nearestExit: nearestExit.value, description: description.value }))
  } else {
    if (!target.value) throw new Error('请选择可换乘的目标线路与运行方向')
    updates.push(...transferEntryUpdates({ rows: catalog.value.rows, dataset: catalog.value }, key.value, target.value.id, routes))
  }
  const result = await api<{ id: string; count: number }>('/api/submissions', 'POST', { updates, source: source.value, recordedAt: recordedAt.value })
  message.value = result.count ? `已提交 ${result.count} 项差异，等待管理员审核。投稿编号：${result.id}` : '内容与现有记录相同，没有新增差异。'
}) }
async function loadAdmin() {
  await loadCatalog()
  batches.value = await api('/api/admin/batches', 'GET')
  history.value = await api('/api/admin/history', 'GET')
}
function selectBatch(batch: Batch) { adminSection.value = 'review'; selected.value = batch; accepted.value = batch.changes.filter(c => !c.decision && c.kind !== 'conflict').map(c => c.id); detailedGroups.value = []; conflicts.value = false; message.value = '' }
function toggle(id: string) { if (unresolved.value.some(change => change.id === id && change.kind === 'conflict')) conflicts.value = false; accepted.value = accepted.value.includes(id) ? accepted.value.filter(x => x !== id) : [...accepted.value, id] }
async function review(rejectAll = false) { await action(async () => {
  const batch = selected.value
  if (!batch) return
  await api('/api/admin/review', 'POST', { id: batch.id, revision: batch.revision, accept: rejectAll ? [] : accepted.value, reject: rejectAll ? unresolved.value.map(c => c.id) : [], resolveConflicts: conflicts.value, actor: actor.value, note: note.value })
  await loadAdmin(); selected.value = batches.value.find(b => b.id === batch.id) ?? null; accepted.value = []; message.value = '审核已保存，备份及历史记录已生成。'
}) }
async function refreshBatch() { await action(async () => {
  const next = await api<Batch>('/api/admin/refresh', 'POST', { id: selected.value?.id })
  await loadAdmin(); selectBatch(next); message.value = '已按当前正式数据生成新预览；旧批次保留追溯。'
}) }
async function upload(e: any) { await action(async () => {
  // #ifdef H5
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 5 * 1024 * 1024) throw new Error('文件不得超过 5 MB')
  uploadName.value = file.name
  const batch = await api<Batch>(`/api/admin/import?source=${encodeURIComponent(source.value || file.name)}&date=${encodeURIComponent(recordedAt.value)}`, 'POST', await file.arrayBuffer())
  await loadAdmin(); selectBatch(batch); message.value = `已生成预览，${batch.changes.length} 项差异；尚未写入正式数据。`
  // #endif
}) }
async function uploadPatch() { await action(async () => {
  const batch = await api<Batch>('/api/admin/patch', 'POST', JSON.parse(patchText.value))
  await loadAdmin(); selectBatch(batch)
}) }
async function restore() { await action(async () => {
  await api('/api/admin/restore', 'POST', { historyId: restoreId.value, revision: catalog.value?.revision, actor: actor.value, note: note.value, confirm: restoreConfirm.value })
  await loadAdmin(); selected.value = null; message.value = '已恢复该次修改前的数据，并保留回滚记录及备份。'
}) }
</script>

<template>
  <view class="maintenance-page">
    <view class="top"><text class="title">{{mode==='admin'?'资料管理工作台':'协作采集'}}</text><text>{{mode==='admin'?'审核资料，再确认发布；每次操作保留记录。':'正式资料须经审核，未知信息请留空。'}}</text></view>
    <view v-if="mode!=='admin'" class="tabs"><button v-for="tab in [{ id: 'quick', name: '快速填写' }, { id: 'detail', name: '详细填写' }, { id: 'transfer', name: '换乘填写' }, ...(privateAdmin ? [{ id: 'admin', name: '管理员' }] : [])]" :key="tab.id" :class="{ active: mode === tab.id }" @tap="setMode(tab.id as Mode)">{{ tab.name }}</button></view><button v-else class="admin-return" @tap="setMode('quick')">前往采集表单 ›</button>
    <view v-if="error" role="alert" class="error">{{ error }}</view><view v-if="message" role="status" class="message">{{ message }}</view>
    <view v-if="!catalog" class="card" role="status"><text>{{catalogState==='loading'?'正在连接采集服务，加载车站与线路…':'采集服务连接失败，请重试。'}}</text><button v-if="catalogState==='failed'" :disabled="busy" @tap="action(loadCatalog)">重新连接</button><text v-if="catalogState==='failed'" class="hint">本机静态预览不含采集接口；可使用公开采集页面，或运行本机开发 / 管理入口。已填写内容不会因重连清空。</text></view>
    <template v-if="mode !== 'admin' && catalog">
      <view class="card"><text class="heading">{{mode==='transfer'?'先确认下车的车站与方向':'车站与站台方向'}}</text>
        <text class="label">① 线路</text><picker :range="lines.map(l => transitDisplayText(l.name))" :value="lineIndex" @change="lineIndex = choose($event)"><view class="select">{{ transitDisplayText(line?.name ?? '请选择线路') }} ▾</view></picker>
        <text class="label">② 车站</text><picker :range="stations.map(s => s.name)" :value="stationIndex" @change="stationIndex = choose($event)"><view class="select">{{ station?.name }} ▾</view></picker>
        <text class="label">③ 运行方向（终点站）</text><picker :range="directionLabels" :value="directionIndex" @change="directionIndex = choose($event)"><view class="select">{{ directionLabels[directionIndex] }} ▾</view></picker>
        <text class="hint">{{mode==='transfer'?'运行方向是下车前列车开往的终点站，不是你步行的朝向。更换线路、车站或方向会清空当前草稿。':'仅列所选线路的车站与方向。方向不同请分开投稿；切换线路、车站或方向会清空当前采集草稿。'}}</text>
      </view>
      <view v-if="mode === 'quick' || mode === 'detail'" class="card">
        <text class="heading">{{ mode === 'quick' ? '记录一项设施' : '设施详细资料' }}</text>
        <text class="label">设施类型</text><picker :range="facilityTypes" :value="facilityTypes.indexOf(facilityType)" @change="chooseFacility"><view class="select">{{ facilityType }} ▾</view></picker>
        <template v-if="mode === 'quick' && facilityType === '楼梯'"><text class="label">楼梯组</text><view class="facility-groups"><text v-if="!groups.length" class="hint">无</text><button v-for="group in groups" :key="group" :class="['facility-group', { chosen: groupIndex === group - 1 }]" @tap="selectGroup(group)">楼梯 {{ group }}</button><button :disabled="groups.length >= 3" class="facility-group" aria-label="添加楼梯组" @tap="addGroup">{{ groups.length >= 3 ? '已满 3 组' : '＋ 添加' }}</button></view><text v-if="groupIndex >= 0" class="hint">本次提交保存选中的楼梯组；新增门位需在页面底部提交审核。</text></template>
        <template v-if="mode === 'detail'"><text class="label">设施编号（同一设施沿用编号）</text><input v-model="facilityId" placeholder="例如：楼梯1" maxlength="80" /></template>
        <template v-if="mode === 'detail' || facilityType === '电梯' || groupIndex >= 0"><text class="label">对应车厢车门</text><DoorPositionField :key="`${key}-${mode}-${facilityType}-${groupIndex}`" v-model="doors" /><template v-if="facilityType === '楼梯'"><text class="label">是否有上行扶梯</text><picker :range="escalatorChoices" :value="escalatorIndex" @change="escalatorIndex = choose($event)"><view class="select">{{ escalatorChoices[escalatorIndex] }} ▾</view></picker></template></template>
        <template v-if="mode === 'detail'"><text class="label">最近出入口（未核实留空）</text><ExitListField :key="key+'-'+facilityType" v-model="nearestExit" /><text class="label">位置与补充说明</text><textarea v-model="description" placeholder="可记录楼层、连接位置及现场标识" maxlength="2000" /><text class="hint">可记录多组楼梯和电梯；扶梯作为楼梯的附属信息填写。</text></template>
      </view>
      <view v-if="mode === 'transfer'" class="card transfer-form">
        <text class="heading">这次从哪里换到哪里？</text>
        <view class="transfer-origin"><text class="hint">下车站台 · 上方已选</text><text class="origin-name">{{ station?.name }} · {{ transitDisplayText(line?.name ?? '') }}</text><text>往{{ direction?.direction }}</text></view>
        <template v-if="target">
          <text class="label">要换乘哪条线路？</text><picker :range="targetLines.map(l=>transitDisplayText(l.name))" :value="targetLineIndex" @change="chooseTargetLine"><view class="select">{{transitDisplayText(targetLines[targetLineIndex]?.name ?? '')}} ▾</view></picker>
          <text class="label">换乘后往哪个终点站？</text><picker :range="targetDirections.map(s=>'往'+s.direction)" :value="targetDirectionIndex" @change="chooseTargetDirection"><view class="select">往{{target.direction}} ▾</view></picker>
          <text v-if="!target.stops.some(p => p.stationId === station?.id)" class="warning">这次是站外换乘。请把出闸、站外行走和重新进站的过程一起记录。</text>
          <text class="hint">一次记录一个方向。换乘到另一方向请分别提交；更换上方车站或换乘方向会清空这份草稿。</text>
          <view class="route-type-heading"><text class="heading">你实际走的是哪种走法？</text><text class="hint">只填你走过的一种即可。切换走法可补另一种，已填内容会保留。</text></view>
          <view class="transfer-type-tabs"><button v-for="(type,index) in transferRouteTypes" :key="type.key" :class="{active:activeRoute===index}" :aria-label="'记录'+type.title" :aria-pressed="activeRoute===index" @tap="activeRoute=index"><text>{{type.title}}</text><text class="type-status">{{transferRouteHasEvidence(routes[index])?'已有草稿':'未填写'}}</text></button></view>
          <text class="route-type-hint">{{transferRouteTypes[activeRoute].hint}}</text>
          <TransferRouteEditor :key="key+'-'+target.id+'-'+activeRoute" :route="routes[activeRoute]" :target="walkingTarget" />
          <view class="transfer-final">
            <text class="hint">未知项目可以跳过。未填写的走法不会清空已有资料；电梯走法记录不等于已核实完整无障碍通路。</text>
            <button class="preview-transfer" @tap="preview=!preview">{{preview?'收起':'检查'}}本次填写内容 · {{routes.filter(transferRouteHasEvidence).length}} 种走法</button>
            <view v-if="preview" class="transfer-preview"><text class="label">{{transferSummary}}</text><view v-for="(route,index) in routes" :key="route.label"><text class="label">{{transferRouteTypes[index].title}}</text><text class="value">{{routePreview(index).metric ? routePreview(index).metric+'（米,分钟）\n' : ''}}{{routePreview(index).description || '未填写，不修改已有资料'}}</text></view><text class="hint">确认内容后，在下方填写来源和日期，提交审核。</text></view>
          </view>
        </template>
        <text v-else class="hint">所选车站没有可登记的换乘线路。请在上方选择换乘站，再记录实际走法。</text>
      </view>
      <view class="card"><text class="heading">资料来源</text><text class="label">来源 / 现场记录说明</text><input v-model="source" placeholder="采集者、现场记录或资料链接" maxlength="500" /><text class="label">采集日期</text><picker mode="date" :value="recordedAt" @change="recordedAt=dateValue($event)"><view class="select date-select" aria-label="修改采集日期"><text>{{recordedAt}}</text><text>修改 ▾</text></view></picker><button class="primary" :disabled="busy" @tap="submit">提交待审核</button></view>
    </template>
    <template v-if="mode === 'admin' && privateAdmin">
      <view class="admin-intro"><text class="hint">先审核资料，再按需发布。导入文件不会直接覆盖线上数据。</text>
        <view class="admin-nav"><button v-for="item in [{id:'review',name:'审核投稿'},{id:'publish',name:'发布更新'},{id:'tools',name:'维护工具'}]" :key="item.id" :class="{active:adminSection===item.id}" @tap="adminSection=item.id as typeof adminSection">{{item.name}}</button></view>
      </view>
      <view v-if="adminSection==='review' && !selected" class="card"><view class="admin-heading"><text class="heading">待审核 · {{pendingBatches.length}} 批</text><button :disabled="busy" @tap="action(loadAdmin)">刷新列表</button></view><text class="hint">打开投稿，核对内容后合并。</text>
        <text v-if="!pendingBatches.length" class="hint">{{busy ? '正在读取待审资料…' : '当前没有待审核投稿。'}}</text>
        <button v-for="batch in pendingBatches" :key="batch.id" class="batch-link" @tap="selectBatch(batch)"><text>{{batch.source}}</text><text class="hint">{{batch.recordedAt}} · {{batch.changes.filter(c=>!c.decision).length}} 项待核对 ›</text></button>
      </view>
      <DataReleasePanel v-show="adminSection==='publish'" :active="adminSection==='publish'" :actor="actor" :note="note"><template #audit><OperatorRecord v-model:actor="actor" v-model:note="note" /></template></DataReleasePanel>
      <view v-if="adminSection==='tools'" class="card"><text class="heading">维护工具</text><text class="hint">不属于日常审核，按需打开。Excel 导入先进入待审区；恢复操作保留原确认流程。</text><button @tap="adminTool=adminTool==='excel'?null:'excel'">表格导入与导出 {{adminTool==='excel'?'−':'›'}}</button><button @tap="adminTool=adminTool==='topology'?null:'topology'">高级 · 完整站内通路 {{adminTool==='topology'?'−':'›'}}</button><button @tap="adminTool=adminTool==='history'?null:'history';action(loadAdmin)">历史与恢复 {{adminTool==='history'?'−':'›'}}</button></view>
      <view v-if="adminSection==='tools' && adminTool==='excel'" class="card"><text class="heading">Excel 人工同步</text><input v-model="source" placeholder="来源（留空使用文件名）" maxlength="500" /><picker mode="date" :value="recordedAt" @change="recordedAt=dateValue($event)"><view class="select date-select" aria-label="修改采集日期"><text>{{recordedAt}}</text><text>修改 ▾</text></view></picker>
        <!-- #ifdef H5 --><component :is="'input'" class="file" type="file" accept=".xlsx" :disabled="busy" @change="upload" /><!-- #endif -->
        <text v-if="uploadName" class="hint">{{ uploadName }}</text><text class="hint">保留28列；按表头匹配。上传只生成预览。文件操作请使用网页入口。</text>
        <button :disabled="busy" @tap="action(async () => { await downloadMaintenance('/api/admin/export.xlsx', '', 'rongxing-maintenance.xlsx'); message = '已导出当前正式资料。' })">导出最新 Excel</button>
        <button :disabled="busy" @tap="action(async () => { await api('/api/admin/backup', 'POST', {}); message = '完整数据库备份已保存。' })">备份数据库</button>
      </view>
      <view v-if="adminSection==='review' && selected" class="card review-card"><button class="review-back" @tap="selected=null; accepted=[]; detailedGroups=[]; conflicts=false">‹ 返回待审核列表</button><view class="review-heading"><view><text class="heading">核对投稿</text><text class="review-meta">{{selected.source}} · {{selected.recordedAt}}</text></view><text class="review-count">{{unresolved.length}} 项待审核</text></view>
        <text class="review-intro">默认选中无冲突内容，可逐组调整；冲突须单独选择并确认。</text>
        <view v-if="selected.revision !== catalog?.revision" class="review-stale"><text>正式资料已更新，请重新预览后再审核。</text><button :disabled="busy" @tap="refreshBatch">重新预览</button></view>
        <text v-for="warning in selected.warnings" :key="warning" class="warning">{{ warning }}</text>
        <view v-for="group in groupedChanges" :key="group.id" class="review-group">
          <view class="review-group-header"><view><text class="review-location">{{identityLabel(group.changes[0])}}</text><text class="review-group-title">{{groupTitle(group)}}</text></view><button v-if="groupState(group).safe.length" class="review-select" @tap="toggleGroup(group)">{{groupState(group).all?'✓ 已选':'选择这组'}}</button></view>
          <view v-for="change in visibleChanges(group)" :key="change.id" :class="['review-fact',{'review-conflict':change.kind==='conflict'}]">
            <view class="review-fact-main"><text class="review-fact-label">{{fieldLabel(change.field)}}</text><text class="review-fact-value">{{change.details ? '整组更新，请展开查看详细变化' : reviewValue(change.field,change.after)}}</text><text v-if="!accepted.includes(change.id)" class="review-unselected">未选</text></view>
            <template v-if="change.kind==='conflict'"><text class="review-before">冲突 · 现有：{{reviewValue(change.field,change.before)}}<template v-if="change.base !== undefined"> · 基线：{{reviewValue(change.field,change.base)}}</template></text><button class="conflict-choice" @tap="toggle(change.id)">{{accepted.includes(change.id)?'✓ 已选择投稿值':'选择投稿值'}}</button></template>
            <text v-else-if="change.before !== '' && change.before !== null && change.before !== undefined" class="review-before">现有：{{reviewValue(change.field,change.before)}}</text>
          </view>
          <button class="review-more" @tap="toggleDetails(group.id)">{{detailedGroups.includes(group.id)?'收起字段':'逐项核对 / 调整'}} {{detailedGroups.includes(group.id)?'⌃':'⌄'}}</button>
          <view v-if="detailedGroups.includes(group.id)" class="review-details"><view v-for="change in group.changes" :key="change.id" class="review-detail"><button class="detail-choice" @tap="toggle(change.id)">{{accepted.includes(change.id)?'☑':'☐'}} {{change.field === 'rowKey' ? '所属站台方向' : change.field}}</button><text class="review-before">现有：{{display(change.before)}}<template v-if="change.base !== undefined"> · 基线：{{display(change.base)}}</template></text><text class="review-detail-value">投稿：{{display(change.after)}}</text><text v-for="detail in change.details" :key="detail.field" class="review-before">{{detail.field}}：{{display(detail.before)}} → {{display(detail.after)}}</text></view></view>
        </view>
        <OperatorRecord v-model:actor="actor" v-model:note="note" />
        <label v-if="selectedConflicts" class="confirm"><checkbox :checked="conflicts" @tap="conflicts = !conflicts" />确认所选 {{selectedConflicts}} 项冲突使用投稿值</label>
        <button class="primary" :disabled="busy || !accepted.length || selected.revision !== catalog?.revision || (!!selectedConflicts && !conflicts)" @tap="review(false)">合并已选内容（{{ accepted.length }} 项）</button><text class="review-footnote">未选内容保留待审；合并后可在“发布更新”中发布。</text><button class="review-secondary" :disabled="busy || !unresolved.length" @tap="review(true)">拒绝剩余全部内容</button>
        <button class="review-secondary" @tap="action(async () => { await downloadMaintenance('/api/admin/source/' + selected!.id, '', 'original-upload.bin') })">下载原始投稿文件</button>
      </view>
      <view v-if="adminSection==='tools' && adminTool==='topology'" class="card"><text class="heading">完整导航拓扑补丁</text><text class="hint">粘贴现有单站维护导出的 station-entry/1 JSON，整组校验和审核；快速采集摘要不会猜测生成通路。</text><textarea v-model="patchText" placeholder="station-entry/1 JSON" maxlength="500000" /><button :disabled="busy" @tap="uploadPatch">校验并预览导航更新</button></view>
      <view v-if="adminSection==='tools' && adminTool==='history'" class="card"><text class="heading">修改历史与恢复</text><view v-for="item in history" :key="item.id" class="history"><text>{{ item.createdAt }} · {{ item.actor }}</text><text>{{ item.note }}</text><button @tap="restoreId = item.id; restoreConfirm = ''">选择恢复此修改之前的数据</button><text class="hint">{{ item.id }}</text></view><template v-if="restoreId"><OperatorRecord v-model:actor="actor" v-model:note="note" /><text class="warning">将完整恢复至 {{ restoreId }} 修改前的状态，之后修改也会撤回；当前数据将备份。</text><input v-model="restoreConfirm" placeholder="输入上述完整历史ID以确认" /><button :disabled="busy" @tap="restore">确认恢复并记录回滚</button></template></view>
    </template>
  </view>
</template>

<style scoped>
.admin-return{margin:0;padding:10px 0;text-align:left;background:transparent;color:#546b60}.admin-return::after{border:0}
.admin-intro { margin-top:20px; }.admin-nav{display:flex;gap:6px}.admin-nav button{flex:1;margin:0;padding:12px 4px}.admin-heading{display:flex;align-items:center;justify-content:space-between;gap:10px}.admin-heading .heading{margin:0}.admin-heading button{margin:0;padding:8px 10px}.batch-link{text-align:left;width:100%;background:#f4f8f5}.batch-link>text{display:block}

.route > view > .label, .route > view > .hint, .measurements .label { display: block; }
.walking-template { border-top: 1px solid #d7e3dc; margin-top: 14px; padding-top: 4px; }
.walking-template > text { display: block; }
.walking-template > .value { padding: 12px; background: #edf6f0; border-radius: 8px; }
.route-toggle { text-align: left; font-size: 16px; font-weight: 700; background: #f4f8f5; }
.measurements { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }.measurements > view { min-width: 0; }
.transfer-summary, .transfer-preview { display: block; background: #edf6f0; padding: 12px; margin-top: 12px; border-radius: 8px; line-height: 1.7; }
.transfer-preview .value { display: block; }.transfer-preview .label { display: block; }
.maintenance-page { max-width: 600px; margin: auto; padding: 18px 14px 48px; color: #203b30; font-size: 15px; box-sizing: border-box; }
.top text, .card > text, .diff > text, .history text { display: block; }
.top { margin: 12px 0 20px; line-height: 1.7; }.title { font-size: 24px; font-weight: 700; }.tabs { display: flex; flex-wrap: wrap; gap: 6px; }.tabs button { flex: 1 0 40%; margin: 0; font-size: 14px; }.active { color: #fff; background: #17664c; }
.card { background: #fff; border: 1px solid #d7e3dc; border-radius: 14px; padding: 16px; margin-top: 14px; overflow-wrap: anywhere; }.heading { font-size: 18px; font-weight: 700; margin-bottom: 12px; }.label { margin-top: 14px; margin-bottom: 7px; font-weight: 600; }.hint { color: #546b60; font-size: 13px; line-height: 1.7; margin: 8px 0; }.select, input, textarea { background: #f4f8f5; border: 1px solid #d7e3dc; border-radius: 8px; padding: 12px; box-sizing: border-box; width: 100%; font-size: 15px; }input { min-height: 46px; height: auto; margin-bottom: 8px; }textarea { min-height: 92px; height: 110px; }.file { min-height: 58px; }button { margin-top: 10px; font-size: 14px; min-height: 44px; line-height: 1.5; padding: 12px 8px; overflow-wrap: anywhere; }.primary { background: #17664c; color: #fff; }.error, .message { padding: 14px; margin-top: 14px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }.error { color: #8c2631; background: #fff0f0; }.message { background: #e7f4ed; }.warning { color: #854a0c; line-height: 1.7; margin: 8px 0; }.route, .diff, .history { border-top: 1px solid #d7e3dc; padding: 12px 0; }.diff.conflict { background: #fff6e9; padding: 10px; }.value { font-size: 14px; white-space: pre-wrap; line-height: 1.7; overflow-wrap: anywhere; }.choice { text-align: left; }.confirm { display: flex; align-items: center; margin-top: 18px; font-size: 14px; }.identity { word-break: break-all; }
</style>
<style scoped>.facility-groups{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.facility-group{margin:0;min-height:44px;padding:8px 14px;font-size:15px;line-height:28px;background:#f2f5f3;color:#3f6250}.facility-group::after{border:0}.facility-group.chosen{background:#176b52;color:#fff}</style>
<style scoped>.transfer-origin{margin:12px 0 18px;padding:10px 0 10px 12px;border-left:3px solid #438565;font-size:14px;line-height:1.7;color:#5d7766}.transfer-origin text{display:block}.transfer-origin .origin-name{font-size:17px;color:#2d4e3a;font-weight:650}.route-type-heading{margin-top:24px}.transfer-type-tabs{display:flex;gap:6px;margin-top:12px}.transfer-type-tabs button{flex:1;min-width:0;margin:0;padding:11px 3px;background:#f4f7f5;color:#536e5b;font-size:14px;line-height:1.6}.transfer-type-tabs button::after{border:0}.transfer-type-tabs button.active{background:#176b52;color:#fff}.transfer-type-tabs text{display:block}.type-status{font-size:11px;opacity:.8}.route-type-hint{display:block;margin:12px 0;font-size:13px;color:#6b7f71;line-height:1.7}.transfer-final{border-top:1px solid #e3eae5;margin-top:22px;padding-top:12px}.preview-transfer{width:100%;font-size:15px;line-height:1.6;min-height:46px;background:#eff5f1;color:#176b52;padding:11px 8px;margin:14px 0 0}.preview-transfer::after{border:0}</style>
<style scoped>.route-type-heading>.heading,.route-type-heading>.hint{display:block}.route-type-heading>.hint{margin-top:6px}</style>
<style scoped>.date-select{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:46px}.date-select>text:last-child{font-size:14px;color:#6b7f71}</style>
<style scoped>
.review-heading,.review-group-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.review-heading>view,.review-group-header>view{min-width:0;flex:1}.review-heading .heading,.review-meta,.review-location,.review-group-title{display:block}.review-heading .heading{margin:0}.review-meta,.review-intro,.review-footnote{font-size:13px;line-height:1.65;color:#657b6d}.review-meta{margin-top:4px}.review-count{flex-shrink:0;font-size:13px;color:#47755d;padding-top:3px}.review-intro{display:block;margin:12px 0 4px}.review-group{border-top:1px solid #e5ece7;margin-top:16px;padding-top:16px}.review-location{font-size:13px;line-height:1.5;color:#718579;overflow-wrap:anywhere}.review-group-title{font-size:18px;line-height:1.5;font-weight:700;color:#284b38;margin-top:3px}.review-select,.review-more,.detail-choice,.conflict-choice,.review-secondary{background:transparent;color:#176b52}.review-select::after,.review-more::after,.detail-choice::after,.conflict-choice::after,.review-secondary::after{border:0}.review-select{margin:0;min-width:74px;padding:9px 4px;text-align:right}.review-fact{padding:9px 0;border-bottom:1px solid #f0f3f1}.review-fact-main{display:flex;align-items:baseline;gap:12px}.review-fact-label{width:84px;flex-shrink:0;color:#667a6d;font-size:13px}.review-fact-value{flex:1;min-width:0;font-size:15px;line-height:1.65;color:#254535;white-space:pre-wrap;overflow-wrap:anywhere}.review-unselected{font-size:12px;color:#8b6b38;white-space:nowrap}.review-before{display:block;font-size:12px;line-height:1.6;color:#78877d;margin-top:4px;overflow-wrap:anywhere}.review-conflict{padding:10px;border-radius:8px;background:#fff7e9;margin:8px 0}.review-conflict .review-before{color:#835c2e}.conflict-choice{margin:2px 0 0;padding:5px 0;text-align:left;color:#8a5921}.review-more{margin:2px 0 0;padding:8px 0;text-align:left;font-size:13px}.review-details{background:#f6f8f7;border-radius:8px;padding:4px 12px}.review-detail{padding:8px 0;border-bottom:1px solid #e5ece7}.review-detail:last-child{border:0}.detail-choice{margin:0;padding:4px 0;text-align:left;min-height:40px}.review-detail-value{display:block;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.review-footnote{display:block;margin-top:8px}.review-secondary{font-size:13px;padding:8px 0;text-align:left}.review-stale{background:#fff4e1;color:#82552c;border-radius:8px;padding:10px;margin-top:12px}.review-stale text{display:block}.review-stale button{margin:5px 0 0;padding:7px 12px}.review-card .primary{width:100%}
.review-back{margin:0 0 12px;padding:0;text-align:left;min-height:44px;background:transparent;color:#176b52}.review-back::after{border:0}
</style>
