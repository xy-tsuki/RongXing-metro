<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { planJourney } from '../core'
import { validateDataset } from '../core/validation'
import type { RouteMode, JourneyRoute, MetroDataset } from '../core/types'
import { demoDataset, demoScenarios } from '../data/demo'
import { fuzhouDataset, fuzhouDataErrors } from '../data/fuzhou'
import { loadPersonalDataset, savePersonalDataset } from '../data/local-store'
import StationEditor from '../maintenance/StationEditor.vue'
import RouteTimeline from './RouteTimeline.vue'
import { lineInk } from './route-presentation'
import { applyLongStationNames } from '../data/ui-fixtures'

const props = defineProps<{ fixture?: string }>()
const datasetMode = ref<'real' | 'demo'>('real')
const loaded = loadPersonalDataset(fuzhouDataset)
const data = reactive(loaded.dataset) as MetroDataset
const personalNotice = ref(loaded.warning ?? '')
const maintenanceOpen = ref(false)
const maintenanceError = ref('')
const backupText = ref('')
const backupMessage = ref('')
const from = ref(data.stations.find(s => s.name === '福州火车站')?.id ?? data.stations[0]?.id ?? '')
const to = ref(data.stations.find(s => s.name === '机场')?.id ?? data.stations[data.stations.length - 1]?.id ?? '')
const dataErrors = computed(() => [...(datasetMode.value === 'real' ? fuzhouDataErrors : []), ...validateDataset(data)])
const isDemo = computed(() => datasetMode.value === 'demo')
const mode = ref<RouteMode>('shortest')
const result = ref<ReturnType<typeof planJourney> | null>(null)
const selectedRoute = ref(0)
const selectedCombination = ref(0)
const combinationChosen = ref(false)
const busy = ref(false)
const editing = ref(false)
const picker = ref<'from' | 'to' | null>(null)
const query = ref('')
type Sheet = 'scenarios' | 'routes' | 'doors' | 'network' | 'data'
const sheet = ref<Sheet | null>(null)
const expanded = ref<string[]>([])
const fixtureApplied = ref(false)
const modes: { id: RouteMode; icon: string; name: string; desc: string }[] = [
  { id: 'shortest', icon: '↗', name: '最近路线', desc: '优先缩短站内步行' },
  { id: 'few-stairs', icon: '≋', name: '少走楼梯', desc: '优先使用扶梯与电梯' },
  { id: 'elevator', icon: '↕', name: '仅限电梯', desc: '只接受连续已核实的电梯与轮椅通路' }
]
const stationName = (id: string) => data.stations.find(s => s.id === id)?.name ?? '请选择车站'
const filteredStations = computed(() => data.stations.filter(s => s.name.includes(query.value.trim())))
const scenarios = computed(() => demoScenarios.filter(s => data.stations.some(station => station.id === s.from) && data.stations.some(station => station.id === s.to)))
const route = computed(() => result.value?.routes[selectedRoute.value])
const currentMode = computed(() => modes.find(m => m.id === mode.value)!)
const sheetTitle = computed(() => ({ scenarios: '选择线网与演示场景', routes: '选择乘车方案', doors: '选择一组推荐车门', network: '运营线网与覆盖车站', data: '数据与规划说明' })[sheet.value ?? 'data'])
const errorTitle = computed(() => dataErrors.value.length ? '数据加载失败' : result.value?.status === 'incomplete' ? '站内资料还需补全' : result.value?.status === 'invalid' ? '请检查起点和终点' : '暂未找到可通行方案')
const errorMessages = computed(() => result.value?.diagnostics.filter(text => !text.startsWith('范围：') && !text.startsWith('候选范围：') && !text.startsWith('合成演示数据：')) ?? [])
const actionableErrors = computed(() => errorMessages.value.filter(text => !text.startsWith('已录入站内数据时') && !text.startsWith('线路候选')))
const searchLimited = computed(() => result.value?.diagnostics.some(text => text.includes('搜索') && (text.includes('上限') || text.includes('截断'))))
const linesForStation = (id: string) => data.lines.filter(l => data.services.some(s => s.lineId === l.id && s.stops.some(p => p.stationId === id)))
function calculate() {
  busy.value = true; selectedRoute.value = 0; selectedCombination.value = 0; combinationChosen.value = false; expanded.value = []
  try { result.value = dataErrors.value.length
    ? { status: 'invalid', routes: [], diagnostics: ['当前数据包未通过校验，已停止规划。', ...dataErrors.value] }
    : planJourney(data, { from: from.value, to: to.value, mode: mode.value }) }
  catch { result.value = { status: 'invalid', routes: [], diagnostics: ['数据加载或计算失败，请检查数据文件后重试。'] } }
  finally { busy.value = false; editing.value = false }
}
function changeMode(value: RouteMode) { mode.value = value; if (result.value) calculate() }
function openPicker(value: 'from' | 'to') { picker.value = value; query.value = '' }
function chooseStation(id: string) { if (picker.value === 'from') from.value = id; else to.value = id; picker.value = null; result.value = null; editing.value = true }
function swap() { const previous = from.value; from.value = to.value; to.value = previous; if (result.value) calculate() }
function loadScenario(scenario: typeof demoScenarios[number]) { from.value = scenario.from; to.value = scenario.to; mode.value = scenario.mode; sheet.value = null; calculate() }
function toggle(id: string) { expanded.value = expanded.value.includes(id) ? expanded.value.filter(x => x !== id) : [...expanded.value, id] }
function selectRoute(i: number) { selectedRoute.value = i; selectedCombination.value = 0; expanded.value = []; sheet.value = null }
function selectCombination(i: number) { selectedCombination.value = i; combinationChosen.value = true; sheet.value = null }
function routeLabel(item: JourneyRoute) { return item.legs.length ? item.legs.map(l => l.lineName.replace('演示', '')).join(' → ') : '站外步行衔接，无需乘车' }
const minutes = (value: number | null) => value === null ? '待补' : Math.ceil(value)
const stopCount = (item: JourneyRoute) => item.legs.reduce((sum, leg) => sum + leg.stopCount, 0)
const outsideCount = (item: JourneyRoute) => (item.accessTransfers?.length ?? 0) + (item.egressTransfers?.length ?? 0) + item.transfers.filter(t => t.kind === 'external').length
function replaceData(next: MetroDataset) {
  backupText.value = ''; backupMessage.value = ''
  for (const key of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[key]
  Object.assign(data, next)
}
function useDataset(kind: 'real' | 'demo') {
  datasetMode.value = kind
  const loadedNext = loadPersonalDataset(kind === 'real' ? fuzhouDataset : demoDataset)
  replaceData(loadedNext.dataset)
  personalNotice.value = loadedNext.warning ?? ''
  from.value = kind === 'real' ? data.stations.find(s => s.name === '福州火车站')?.id ?? data.stations[0]?.id ?? '' : 's-west'
  to.value = kind === 'real' ? data.stations.find(s => s.name === '机场')?.id ?? data.stations[data.stations.length - 1]?.id ?? '' : 's-bay'
  sheet.value = null; calculate()
}
function applyDataset(next: MetroDataset) {
  maintenanceError.value = ''
  try {
    if (!isDemo.value && next.provenance.kind === 'demo') throw new Error('合成资料只能导入独立演示线网，请先切换线网。')
    savePersonalDataset(isDemo.value ? demoDataset : fuzhouDataset, next)
    replaceData(next); maintenanceOpen.value = false
    personalNotice.value = '单站资料已校验、合并并保存在本机，推荐已重新计算。可在“数据说明”备份当前完整资料。'
    calculate()
  } catch (e) { maintenanceError.value = `保存失败：${(e as Error).message}。草稿已保留，请先导出备份。` }
}
function backupDataset() {
  backupText.value = JSON.stringify(data, null, 2)
  uni.setClipboardData({ data: backupText.value,
    success: () => { backupMessage.value = '完整数据已复制，请保存为 UTF-8 JSON 文件。' },
    fail: () => { backupMessage.value = '未能自动复制，可从下方文本框选择复制完整内容。' }
  })
}
calculate()
watch(() => props.fixture, value => {
  if (!import.meta.env.DEV || fixtureApplied.value || !['long-names', 'blocked-lift'].includes(value ?? '')) return
  useDataset('demo')
  if (value === 'long-names') applyLongStationNames(data)
  else {
    // Isolated development fault injection. Never modifies or saves the real Fuzhou dataset.
    data.walkEdges.forEach(edge => { if (edge.kind === 'lift') edge.wheelchair = 'blocked' })
    to.value = 's-east'; mode.value = 'elevator'
    personalNotice.value = '不可达界面测试：合成通路设为不可通行，不代表福州真实电梯覆盖情况。'
  }
  fixtureApplied.value = true; calculate()
}, { immediate: true })
</script>

<template>
  <view class="app-shell">
    <view class="topbar">
      <view class="brand"><view class="brand-mark">榕</view><text class="brand-name">榕行</text><text class="page-label">路线详情</text></view>
      <view class="top-actions"><button class="city-tag" aria-label="切换线网" @tap="sheet = 'scenarios'">福州 · {{ isDemo ? '演示' : '运营' }} ⌄</button><button class="text-button" aria-label="数据说明" @tap="sheet = 'data'">数据说明</button></view>
    </view>

    <view class="planner-card">
      <button v-if="!editing && result" class="compact-trip" aria-label="修改起终点" @tap="editing = true"><view class="compact-endpoints"><text>{{ stationName(from) }}</text><text class="compact-arrow"> → </text><text>{{ stationName(to) }}</text></view><text class="compact-edit">修改</text></button>
      <view v-else class="trip-fields">
        <button class="station-field" aria-label="选择起点" @tap="openPicker('from')"><text class="field-label">从</text><text class="field-value">{{ stationName(from) }}</text><text class="field-chevron">⌄</text></button>
        <button class="station-field" aria-label="选择终点" @tap="openPicker('to')"><text class="field-label destination-label">到</text><text class="field-value">{{ stationName(to) }}</text><text class="field-chevron">⌄</text></button>
        <button class="swap-button" aria-label="交换起终点" @tap="swap">⇅</button>
      </view>
      <view class="mode-options"><button v-for="item in modes" :key="item.id" :class="['mode-button', { active: mode === item.id }]" :aria-label="item.name" :aria-pressed="mode === item.id" @tap="changeMode(item.id)"><text class="mode-icon">{{ item.icon }}</text><text>{{ item.name }}</text></button></view>
      <text v-if="mode !== 'shortest'" class="mode-description">{{ currentMode.desc }}</text>
      <button v-if="!result || editing" class="primary-button calculate-button" :loading="busy" @tap="calculate">规划我的路线 <text>→</text></button>
    </view>

    <view v-if="!route" class="demo-note">{{ isDemo ? '合成演示 · 不可用于真实乘车' : '真实运营线网 · 精细指引待逐站采集' }}</view>
    <view v-if="personalNotice" class="notice">{{ personalNotice }}</view>
    <view v-if="!result" class="empty-card"><text class="empty-title">起终点已更新</text><text class="empty-message">点击“规划我的路线”，查看乘车方案和推荐车门。</text></view>
    <view v-else-if="!route" class="empty-card"><text class="empty-title">{{ errorTitle }}</text><text v-for="(message, i) in actionableErrors" :key="i" class="empty-message">{{ message }}</text><text v-if="mode === 'elevator' && result?.status === 'incomplete'" class="empty-message">电梯位置与衔接通道尚需录入，资料未确认前不生成无障碍指引。</text><button v-if="mode === 'elevator'" class="secondary-button" @tap="changeMode('shortest')">切换为最近路线</button><button class="secondary-button" @tap="openPicker('to')">重新选择终点</button><button class="utility-button" @tap="toggle('diagnostics')"><text>查看规划检查详情</text><text>{{ expanded.includes('diagnostics') ? '−' : '＋' }}</text></button><view v-if="expanded.includes('diagnostics')"><text v-for="(message, i) in result.diagnostics" :key="i" class="empty-message">{{ message }}</text></view></view>

    <template v-if="route && result">
      <view class="route-summary">
        <view class="route-summary-main">
          <view class="summary-metrics"><text class="summary-time">{{ route.legs.length ? stopCount(route) + ' 站' : '无需乘车' }}</text><text v-if="route.legs.length">{{ route.transferCount ? '换乘 ' + route.transferCount + ' 次' : '直达' }}</text><text v-if="route.walkingMetres !== null" class="summary-distance">步行 {{ Math.round(route.walkingMetres) }} 米</text></view>
          <text class="summary-title">{{ isDemo ? '演示数据 · 不用于乘车' : route.granularity === 'detailed' ? '已录入通路内优化' : '真实线网 · 精细指引待补' }}{{ route.totalMinutes !== null ? ' · 估算 ' + minutes(route.totalMinutes) + ' 分钟' : '' }}</text>
        </view>
        <button v-if="result.routes.length > 1" class="change-route-button" aria-label="比较方案" @tap="sheet = 'routes'">方案 {{ result.routes.length }} ⌄</button>
      </view>
      <view v-if="route.granularity !== 'detailed'" class="coverage-note"><text class="coverage-title">{{ mode === 'elevator' ? '连续无障碍指引待核实' : '精细指引待补充' }}</text><text class="coverage-detail">{{ !route.legs.length ? '具体出入口、距离与连续通路尚未核实。' : mode === 'elevator' ? (isDemo ? '演示站内资料尚不完整，以下仅为基础乘车路线，不能作为连续无障碍导航。' : '福州电梯全覆盖；具体电梯与衔接通路尚未核实，以下仅供查看基础乘车路线。') : '车厢、车门与设施逐站采集中；当前按换乘次数和站数比较。' }}</text></view>
      <view v-else-if="result.status === 'incomplete'" class="notice">部分候选资料或搜索范围尚不完整，请查看规划依据。</view>
      <view v-if="searchLimited" class="notice">候选方案尚未全部比较，当前结果可能还有更优备选。详情见“规划依据与数据边界”。</view>

      <RouteTimeline :key="route.id + '-' + mode" :route="route" :dataset="data" :combination-index="selectedCombination" :explicit-selection="combinationChosen" :demo="isDemo" :destination-name="stationName(to)" @open-combinations="sheet = 'doors'"/>
      <view v-if="route.equalChoicesTruncated" class="notice">等价组合较多，当前仅展示部分最优组合。</view>
      <text class="estimate-note">{{ isDemo ? '时间不含候车，仅为演示行车与站内步行估算。' : '尚未接入时刻表；不推测乘车耗时或具体电梯通路。滨海快线按普通车停站规划。' }}</text>
      <button class="utility-button" @tap="toggle('diagnostics')"><text>规划依据与数据边界</text><text>{{ expanded.includes('diagnostics') ? '−' : '+' }}</text></button>
      <view v-if="expanded.includes('diagnostics')" class="notice"><text v-for="(message, i) in result.diagnostics" :key="i" class="diagnostic-line">{{ message }}</text></view>
    </template>
    <view class="more-tools"><button class="utility-button" aria-label="更多功能" @tap="toggle('tools')"><text>资料维护与更多功能</text><text>{{ expanded.includes('tools') ? '−' : '＋' }}</text></button><view v-if="expanded.includes('tools')">    <view class="footer-tools"><button class="utility-button" aria-label="个人资料录入" @tap="maintenanceOpen = true"><text>个人维护 · 录入单站资料</text><text>＋</text></button><button class="utility-button" @tap="sheet = 'scenarios'"><text>切换线网与演示场景</text><text>→</text></button><button class="utility-button" @tap="sheet = 'network'"><text>查看运营线网与覆盖车站</text><text>→</text></button></view>
</view></view>
    <view class="page-footer">榕行 · 本地计算 · 无需定位</view>

    <view v-if="picker" class="modal-backdrop" @tap="picker = null"><view class="modal-sheet" @tap.stop>
      <view class="modal-header"><text class="modal-title">{{ picker === 'from' ? '选择起点' : '选择终点' }}</text><button class="close-button" aria-label="关闭选站" @tap="picker = null">×</button></view>
      <input v-model="query" class="station-search" placeholder="输入车站名称" :focus="true" aria-label="搜索车站"/>
      <text class="picker-note">{{ data.stations.length }} 个{{ isDemo ? '虚构车站 · 仅供演示' : '运营上下客站点 · 出站换乘独立列出' }}</text>
      <scroll-view scroll-y class="sheet-scroll station-list"><button v-for="station in filteredStations" :key="station.id" class="station-choice" @tap="chooseStation(station.id)"><view class="choice-heading"><text class="choice-name">{{ station.name }}</text><text v-if="station.id === (picker === 'from' ? from : to)" class="selected-check">✓</text></view><view class="station-lines"><text v-for="line in linesForStation(station.id)" :key="line.id" class="mini-line" :style="{ borderLeftColor: line.color }">{{ line.name }}</text></view></button><text v-if="!filteredStations.length" class="empty-message">没有找到车站，试试“中央”或“海湾”。</text></scroll-view>
    </view></view>

    <view v-if="sheet" class="modal-backdrop" @tap="sheet = null"><view class="modal-sheet" @tap.stop>
      <view class="modal-header"><text class="modal-title">{{ sheetTitle }}</text><button class="close-button" aria-label="关闭弹窗" @tap="sheet = null">×</button></view>
      <scroll-view scroll-y class="sheet-scroll">
        <template v-if="sheet === 'scenarios'"><button class="scenario-item" @tap="useDataset('real')"><text class="scenario-name">福州真实运营线网 {{ !isDemo ? '✓' : '' }}</text><text class="scenario-stations">已核对运营范围；站内设施与车门逐站补充。</text></button><button class="scenario-item" @tap="useDataset('demo')"><text class="scenario-name">独立合成演示线网 {{ isDemo ? '✓' : '' }}</text><text class="scenario-stations">测试车门推荐、三种模式和单站资料录入。</text></button><text v-if="isDemo" class="sheet-description">以下场景全部为合成数据。</text><button v-for="scenario in scenarios" :key="scenario.id" class="scenario-item" @tap="loadScenario(scenario)"><text class="scenario-name">{{ scenario.title }}</text><text class="scenario-stations">{{ stationName(scenario.from) }} → {{ stationName(scenario.to) }}</text></button></template>
        <template v-if="sheet === 'routes' && result"><button v-for="(item, i) in result.routes" :key="item.id" :class="['route-option', { selected: selectedRoute === i }]" @tap="selectRoute(i)"><view class="choice-heading"><text class="option-title">{{ i === 0 ? '推荐方案' : '备选方案 ' + (i + 1) }}</text><text v-if="selectedRoute === i" class="selected-check">✓</text></view><text class="option-metrics">{{ item.totalMinutes === null ? stopCount(item) + ' 站' : '约 ' + minutes(item.totalMinutes) + ' 分钟' }} · {{ item.transferCount ? item.transferCount + ' 次换乘' : '直达' }}</text><text class="option-lines">{{ routeLabel(item) }}</text><text class="option-detail">{{ outsideCount(item) ? '含 ' + outsideCount(item) + ' 段出站步行' : item.transferCount ? '乘车段之间均为站内换乘' : '无需换乘' }}</text><text class="option-detail">{{ item.walkingMetres === null ? '站内距离与楼梯待采集' : '步行 ' + Math.round(item.walkingMetres) + ' 米 · ' + item.stairCount + ' 级普通楼梯' }}</text></button></template>
        <template v-if="sheet === 'doors' && route"><text class="sheet-description">每组都是完整行程的等价推荐。选择后，各段车门与步行指引一起更新。</text><button v-for="(choice, ci) in route.doorCombinations" :key="ci" :class="['combination-button', { chosen: combinationChosen && selectedCombination === ci }]" @tap="selectCombination(ci)"><view class="choice-heading"><text class="combination-title">组合 {{ ci + 1 }}</text><text v-if="combinationChosen && selectedCombination === ci" class="selected-check">已选 ✓</text></view><view v-for="(position, pi) in choice.positions" :key="pi" class="combination-leg"><text class="combination-line">第 {{ pi + 1 }} 段 · {{ route.legs[pi].lineName }}</text><text class="combination-position">{{ position.car }} 号车厢 · {{ position.door }} 号门</text></view></button></template>
        <template v-if="sheet === 'network'"><view v-for="line in data.lines" :key="line.id" class="network-line"><text class="line-badge" :style="{ background: line.color, color: lineInk(line.color) }">{{ line.name }}</text><text class="network-stations">{{ data.services.find(s => s.lineId === line.id)?.stops.map(s => stationName(s.stationId)).join(' — ') }}</text><text class="sheet-description">{{ data.formations.find(f => f.id === data.services.find(s => s.lineId === line.id)?.formationId)?.cars }} 节编组</text></view><text class="sheet-description">{{ isDemo ? '独立演示数据，与真实线网隔离。' : '包含站内换乘及两组出站换乘。未开放、预留、在建站点不参与规划。' }}</text></template>
        <template v-if="sheet === 'data'"><view class="notice">{{ isDemo ? '合成演示数据，不用于真实导航。' : '线网已录入；真实站内节点和车门尚待采集，不套用模拟布局。' }}</view><text class="info-body">{{ data.description }}</text><text class="info-heading">车门与通行路径一起计算</text><text class="info-body">最近路线优先缩短步行；少走楼梯优先扶梯和电梯；仅限电梯使用已确认的连续电梯及无障碍通道。按福州电梯全覆盖的前提设计，覆盖声明不能代替具体通路核实。</text><text class="info-heading">个人维护与数据边界</text><text class="info-body">可按车站、线路和方向录入单站资料，校验后保存在本机，建议导出 CSV 备份。只有已录入的通路参与精细推荐；人工推荐单独保存用于对照。未指定出口，不使用时刻表或实时定位。</text><text class="info-heading">当前数据包</text><text class="info-body">{{ data.version }} · 协议 {{ data.schemaVersion }}。核对来源和日期详见项目 docs/network-sources.md。6号线与F1为4节，其余6节；未提供每车门数和编号。</text></template>
        <template v-if="sheet === 'data'"><text class="info-heading">完整资料备份</text><text class="info-body">草稿 CSV 请在合并前导出。已经合并的资料可复制下方完整数据，保存为 UTF-8 JSON 文件；包含来源和全部单站补录。数据包升级后不会自动迁移本机资料，请保留备份。</text><button class="secondary-button" @tap="backupDataset">复制当前完整数据备份</button><text v-if="backupMessage" class="info-body">{{ backupMessage }}</text><textarea v-if="backupText" :value="backupText" :maxlength="-1" class="backup-text" aria-label="完整数据备份"/></template>
      </scroll-view>
    </view></view>
    <view v-if="maintenanceOpen && data.stations.length" class="maintenance-backdrop"><StationEditor :dataset="data" :initial-station-id="to" :save-error="maintenanceError" @import="applyDataset" @close="maintenanceOpen = false; maintenanceError = ''"/></view>
  </view>
</template>

<style scoped>
.app-shell { max-width: 540px; margin: 0 auto; padding: 0 16px; color: #273b31; background: #fff; font-size: 15px; line-height: 1.55; }
/* Keep native mini-program buttons independent of app-level style isolation. */
.city-tag,.text-button,.compact-trip,.station-field,.swap-button,.mode-button,.primary-button,.secondary-button,.change-route-button,.equivalent-button,.stops-toggle,.utility-button,.close-button,.station-choice,.scenario-item,.route-option,.combination-button { margin: 0; line-height: 1.5; font-family: inherit; font-size: inherit; }
.city-tag::after,.text-button::after,.compact-trip::after,.station-field::after,.swap-button::after,.mode-button::after,.primary-button::after,.secondary-button::after,.change-route-button::after,.equivalent-button::after,.stops-toggle::after,.utility-button::after,.close-button::after,.station-choice::after,.scenario-item::after,.route-option::after,.combination-button::after { border: none; }
.app-shell :deep(uni-button) { line-height: 1.5; }
.app-shell :deep(uni-button)::after { border: none; }
.app-shell button { line-height: 1.5; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 48px; }
.brand { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.brand-mark { width: 31px; height: 31px; background: #176b52; border-radius: 9px; color: #fff; text-align: center; line-height: 31px; font-size: 18px; font-weight: 650; }
.brand-name { font-size: 24px; font-weight: 750; letter-spacing: 1px; }
.page-label { font-size: 13px; color: #62736b; padding-left: 8px; border-left: 1px solid #d4ded7; }
.top-actions { display: flex; align-items: center; gap: 4px; }
.city-tag,.text-button { min-height: 48px; padding: 10px 8px; font-size: 13px; display: flex; align-items: center; color: #526852; background: transparent; }
.planner-card { padding: 0; border-bottom: 1px solid #e5ebe6; background: #fff; position: sticky; top: 0; z-index: 20; }
.compact-trip { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 4px 0; text-align: left; background: transparent; }
.compact-endpoints { font-size: 19px; font-weight: 650; line-height: 1.5; flex: 1; min-width: 0; word-break: break-all; }
.compact-arrow { color: #5a7751; margin: 0 4px; }
.compact-edit { min-height: 44px; min-width: 44px; display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; color: #37654e; font-size: 14px; font-weight: 500; }
.trip-fields { padding-right: 48px; position: relative; }
.station-field { display: flex; align-items: center; width: 100%; min-height: 52px; padding: 8px 4px; gap: 10px; text-align: left; background: transparent; }
.station-field + .station-field { border-top: 1px solid #e5eadf; }
.field-label { font-size: 13px; color: #176b52; background: #edf4e7; border-radius: 5px; padding: 2px 5px; flex-shrink: 0; }
.destination-label { color: #8d652c; background: #f4eddf; }
.field-value { font-size: 19px; font-weight: 650; line-height: 1.45; min-width: 0; flex: 1; overflow-wrap: anywhere; word-break: break-all; }
.field-chevron { color: #647c60; font-size: 18px; flex-shrink: 0; }
.swap-button { position: absolute; right: -4px; top: 50%; margin-top: -24px; width: 48px; height: 48px; min-height: 48px; border: 1px solid #dce4d4; background: #f5f8f0; border-radius: 10px; font-size: 27px; display: flex; align-items: center; justify-content: center; color: #2f6d4c; }
.mode-options { display: flex; gap: 0; margin: 0; }
.mode-button { min-width: 0; min-height: 48px; flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-bottom: 3px solid transparent; border-radius: 0; color: #66756a; background: transparent; font-size: 14px; font-weight: 550; padding: 8px 2px; }
.mode-button.active { border-bottom-color: #176b52; background: transparent; color: #176b52; font-weight: 700; }
.mode-icon { font-size: 18px; }
.mode-description { display: block; margin-top: 9px; font-size: 13px; color: #52684b; }
.primary-button,.secondary-button { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-radius: 9px; padding: 12px 16px; font-size: 16px; font-weight: 600; }
.primary-button { background: #176b52; color: #fff; width: 100%; }
.calculate-button { margin-top: 12px; }
.secondary-button { background: #e6efdd; color: #225d3b; margin-top: 18px; justify-content: center; }
.demo-note { font-size: 13px; color: #77613c; padding: 10px 2px 0; }
.route-summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 15px 0 12px; border-bottom: 1px solid #edf0ed; margin-bottom: 10px; }
.route-summary-main { flex: 1; min-width: 0; }
.summary-title { display: block; color: #69796e; font-size: 13px; line-height: 1.65; margin-top: 3px; }
.summary-metrics { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; font-size: 15px; font-weight: 550; color: #42594a; }
.summary-time { font-size: 21px; font-weight: 700; line-height: 1.4; color: #2c4334; }
.summary-transfer { font-weight: 650; color: #334f40; }.summary-estimate { font-size: 13px; color: #617466; }
.summary-walk { display: block; font-size: 13px; color: #576b4d; margin-top: 4px; }
.change-route-button { min-height: 48px; min-width: 60px; padding: 8px 0 8px 8px; border: 0; border-radius: 0; background: transparent; color: #38634b; font-size: 14px; flex-shrink: 0; }
.coverage-note { background: #f2efe5; border-left: 3px solid #b29a61; border-radius: 0 6px 6px 0; padding: 9px 11px; margin-bottom: 12px; }.coverage-title { display: block; font-size: 14px; font-weight: 650; color: #69552e; }.coverage-detail { display: block; margin-top: 2px; font-size: 13px; line-height: 1.65; color: #6f6249; }
.change-route-button text { display: block; font-size: 12px; font-weight: 400; margin-top: 3px; }
.maintenance-backdrop { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 120; overflow-y: auto; background: #f6f8f7; }
.backup-text { width: 100%; height: 200px; padding: 10px; border: 1px solid #c6d6ce; border-radius: 8px; margin-top: 12px; font-size: 14px; background: #fff; }
.line-badge { display: inline-block; padding: 5px 9px; border-radius: 5px; font-size: 14px; font-weight: 600; }
.estimate-note { display: block; font-size: 13px; line-height: 1.7; color: #52664a; padding: 14px 3px 4px; }
.utility-button { width: 100%; min-height: 52px; display: flex; align-items: center; justify-content: space-between; text-align: left; gap: 10px; border-bottom: 1px solid #dde5d5; padding: 12px 3px; color: #42613e; background: transparent; font-size: 14px; }
.footer-tools { margin-top: 12px; }
.page-footer { padding: 16px 0 calc(20px + env(safe-area-inset-bottom)); color: #738075; font-size: 12px; text-align: center; }
.notice { border: 1px solid #e0d6b5; background: #f3eedf; color: #69562e; font-size: 14px; line-height: 1.75; padding: 12px; border-radius: 9px; margin-bottom: 14px; }
.diagnostic-line { display: block; margin-top: 8px; word-break: break-all; }
.empty-card { background: #fff; border: 1px solid #dce5d3; border-radius: 12px; padding: 20px 17px; margin: 12px 0; }
.empty-title { display: block; font-size: 20px; line-height: 1.5; font-weight: 650; margin-bottom: 14px; }
.empty-message { display: block; font-size: 15px; color: #526348; line-height: 1.8; margin-top: 10px; word-break: break-all; }
.modal-backdrop { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 100; background: #142b2466; display: flex; align-items: flex-end; justify-content: center; padding: 10px; }
.modal-sheet { width: 100%; max-width: 540px; background: #fafcf6; border-radius: 18px; padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); max-height: 90vh; box-shadow: 0 12px 50px #17342335; }
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.modal-title { font-size: 21px; font-weight: 700; flex: 1; line-height: 1.5; }
.close-button { width: 48px; height: 48px; min-height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 28px; color: #486141; background: #eaf1e1; flex-shrink: 0; }
.sheet-scroll { height: 58vh; width: 100%; }
.station-list { height: 49vh; }
.station-search { height: 52px; width: 100%; font-size: 16px; padding: 10px 13px; border: 1px solid #c9d9bb; border-radius: 9px; background: #edf4e5; color: #25472f; }
.picker-note,.sheet-description { display: block; font-size: 13px; line-height: 1.75; color: #52684a; margin: 12px 0; }
.station-choice { width: 100%; min-height: 76px; padding: 14px 4px; text-align: left; border-bottom: 1px solid #dfe7d6; background: transparent; }
.choice-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.choice-name { font-size: 18px; line-height: 1.5; font-weight: 600; word-break: break-all; min-width: 0; flex: 1; }
.station-lines { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.mini-line { font-size: 12px; padding: 3px 6px; border-radius: 4px; background: #e9efdf; font-weight: 600; color: #365332; border-left: 3px solid; }
.selected-check { font-size: 14px; color: #176b52; flex-shrink: 0; }
.scenario-item { display: block; width: 100%; text-align: left; min-height: 76px; padding: 15px 4px; border-bottom: 1px solid #dce6d2; background: transparent; }
.scenario-name { display: block; font-size: 17px; font-weight: 650; margin-bottom: 5px; }
.scenario-stations { display: block; font-size: 14px; line-height: 1.65; color: #52694a; word-break: break-all; }
.route-option { display: block; width: 100%; text-align: left; padding: 16px; margin-bottom: 12px; border: 1px solid #cfdcc2; border-radius: 10px; background: #fff; }
.route-option.selected { background: #eaf3e1; border: 2px solid #2d7851; padding: 15px; }
.option-title { font-size: 17px; font-weight: 650; }
.option-metrics { display: block; font-size: 17px; font-weight: 650; margin-top: 12px; }
.option-lines { display: block; font-size: 15px; color: #365c36; margin-top: 10px; word-break: break-all; }
.option-detail { display: block; font-size: 14px; color: #52684a; margin-top: 8px; }
.combination-button { display: block; width: 100%; padding: 15px; text-align: left; margin-bottom: 12px; border: 1px solid #ccdbbc; background: #fff; border-radius: 10px; }
.combination-button.chosen { border: 2px solid #28704c; background: #edf5e4; padding: 14px; }
.combination-title { font-size: 16px; font-weight: 650; }
.combination-leg { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 5px 9px; border-top: 1px solid #e1e9d7; padding-top: 9px; margin-top: 9px; }
.combination-line { font-size: 13px; color: #536b48; }
.combination-position { font-size: 16px; font-weight: 650; color: #255c37; }
.network-line { padding: 14px 0; border-bottom: 1px solid #d9e5cf; }
.network-stations { display: block; font-size: 16px; line-height: 1.9; color: #3f5d36; margin-top: 12px; word-break: break-all; }
.info-heading { display: block; font-size: 17px; font-weight: 650; margin: 22px 0 10px; }
.info-body { display: block; color: #4b6142; font-size: 15px; line-height: 1.9; word-break: break-all; }
@media (max-width: 359px) {
  .app-shell { padding: 0 12px; }
  .top-actions { gap: 0; }
  .city-tag,.text-button { padding-left: 5px; padding-right: 5px; }
  .brand-name { font-size: 22px; }
  .page-label { display: none; }
  .mode-button { padding-left: 1px; padding-right: 1px; gap: 3px; }
  .mode-icon { font-size: 16px; }
  .modal-sheet { padding-left: 14px; padding-right: 14px; }
}
</style>
