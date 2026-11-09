import { transitDisplayText } from './line-display'
import { computed, effectScope, reactive, ref, watch } from 'vue'
import { planJourney } from '../core'
import { validateDataset } from '../core/validation'
import type { RouteMode, JourneyRoute, MetroDataset } from '../core/types'
import { demoDataset, demoScenarios } from '../data/demo'
import { fuzhouDataset, fuzhouDataErrors } from '../data/fuzhou'
import { loadPersonalDataset, savePersonalDataset } from '../data/local-store'
import { applyLongStationNames } from '../data/ui-fixtures'
import { publishedData, refreshPublishedData } from '../data/published'

import type { DepartureIntent, JourneyTiming } from './timing'
import { estimatedJourneyTiming } from './timing'
import { demoDepartures, departureWindow, displayCandidates } from './departures'
import { recommendedDeparture } from './departure-selection'
import { routeFareLookup } from './fare-presentation'
import type { DepartureCandidate } from './departures'
import { queryTimetable, hasTimetableCoverage, testTimetable } from './test-timetable'

function createJourneySession() {
const datasetMode = ref<'real' | 'demo'>('real')
const loaded = loadPersonalDataset(fuzhouDataset)
const data = reactive(loaded.dataset) as MetroDataset
const personalNotice = ref(loaded.warning ?? '')
const maintenanceOpen = ref(false)
const maintenanceError = ref('')
const backupText = ref('')
const backupMessage = ref('')
const datasetGeneration = ref(0)
const personalCopyPresent = ref(JSON.stringify(loaded.dataset) !== JSON.stringify(fuzhouDataset))
const timetable = computed(() => !personalCopyPresent.value && publishedData.value ? publishedData.value.timetable : testTimetable)
function adoptPublished() {
  const next = publishedData.value?.dataset
  if (!next || datasetMode.value !== 'real' || personalCopyPresent.value || maintenanceOpen.value) return
  const recalculate = result.value !== null
  replaceData(JSON.parse(JSON.stringify(next)))
  if (!data.stations.some(s=>s.id===from.value)) from.value = data.stations[0]?.id ?? ''
  if (!data.stations.some(s=>s.id===to.value)) to.value = data.stations[data.stations.length-1]?.id ?? ''
  if (recalculate) calculate()
  personalNotice.value = '当前使用后台已审核发布数据；个人本机副本仍保留。'
}
watch(publishedData, adoptPublished, { flush:'sync' })
async function loadOfficialNavigation(automatic = false) {
  if (datasetMode.value !== 'real' || automatic && personalCopyPresent.value) return
  const expectedGeneration = datasetGeneration.value
  await refreshPublishedData(!automatic)
  if (datasetGeneration.value !== expectedGeneration || maintenanceOpen.value) return
  if (!automatic) personalCopyPresent.value = false // Explicit view switch; never alters the saved personal copy.
  adoptPublished()
}
function openContribution() { uni.navigateTo({ url: '/pages/maintenance/index' }) }
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
  { id: 'shortest', icon: '↗', name: '最短路线', desc: '优先缩短站内步行' },
  { id: 'few-stairs', icon: '≋', name: '不走楼梯', desc: '优先扶梯、电梯；仍可能含普通楼梯，以方案为准' },
  { id: 'elevator', icon: '↕', name: '无障碍', desc: '只接受连续已核实的电梯与轮椅通路' }
]
const stationName = (id: string) => data.stations.find(s => s.id === id)?.name ?? '请选择车站'
const filteredStations = computed(() => data.stations.filter(s => s.name.includes(query.value.trim())))
const scenarios = computed(() => demoScenarios.filter(s => data.stations.some(station => station.id === s.from) && data.stations.some(station => station.id === s.to)))
const route = computed(() => candidateRuns.value.find(item => item.id === selectedDeparture.value)?.routeOverride ?? result.value?.routes[selectedRoute.value])
const currentMode = computed(() => modes.find(m => m.id === mode.value)!)
const sheetTitle = computed(() => ({ scenarios: '选择线网与演示场景', routes: '选择乘车方案', doors: '选择一组推荐车门', network: '运营线网与覆盖车站', data: '数据与规划说明' })[sheet.value ?? 'data'])
const errorTitle = computed(() => dataErrors.value.length ? '数据加载失败' : result.value?.status === 'incomplete' ? '站内资料还需补全' : result.value?.status === 'invalid' ? '请检查起点和终点' : '暂未找到可通行方案')
const errorMessages = computed(() => result.value?.diagnostics.filter(text => !text.startsWith('范围：') && !text.startsWith('候选范围：') && !text.startsWith('合成演示数据：')) ?? [])
const actionableErrors = computed(() => errorMessages.value.filter(text => !text.startsWith('已录入站内数据时') && !text.startsWith('线路候选')))
const searchLimited = computed(() => result.value?.diagnostics.some(text => text.includes('搜索') && (text.includes('上限') || text.includes('截断'))))
const linesForStation = (id: string) => data.lines.filter(l => data.services.some(s => s.lineId === l.id && s.stops.some(p => p.stationId === id)))
function calculate() {
  busy.value = true; selectedRoute.value = 0; selectedCombination.value = 0; combinationChosen.value = false; expanded.value = []; detailExpanded.value = []; detailScrollTop.value = 0; timingByRoute.value = {}
  try { result.value = dataErrors.value.length
    ? { status: 'invalid', routes: [], diagnostics: ['当前数据包未通过校验，已停止规划。', ...dataErrors.value] }
    : planJourney(data, { from: from.value, to: to.value, mode: mode.value }) }
  catch { result.value = { status: 'invalid', routes: [], diagnostics: ['数据加载或计算失败，请检查数据文件后重试。'] } }
  finally {
    queryWindow.value = departureWindow(departureIntent.value.kind === 'scheduled' && departureIntent.value.departureAt
      ? departureIntent.value.departureAt : new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString())
    if (isDemo.value) candidateRuns.value = demoDepartures(result.value?.routes ?? [], queryWindow.value)
    else {
      const scheduled = queryTimetable(result.value?.routes ?? [], queryWindow.value, timetable.value, data, mode.value)
      queryWindow.value = scheduled.window
      candidateRuns.value = scheduled.departures
    }
    timetableAvailable.value = isDemo.value ? candidateRuns.value.length > 0 : hasTimetableCoverage(result.value?.routes ?? [],timetable.value)
    const fallback = candidates.value.find(item => item.routeIndex === 0) ?? candidates.value[0]
    const recommended = !isDemo.value && timetableAvailable.value
      ? recommendedDeparture(candidates.value, fallback, mode.value, routeFareLookup(data)) : fallback
    selectedDeparture.value = recommended?.id ?? ''
    selectedRoute.value = recommended?.routeIndex ?? 0
    boardPosition.value = { x: 0, y: 0 }
    busy.value = false; editing.value = false
  }
}
function changeMode(value: RouteMode) { mode.value = value; if (result.value) calculate() }
function openPicker(value: 'from' | 'to') { picker.value = value; query.value = '' }
function chooseStation(id: string) { if (picker.value === 'from') from.value = id; else to.value = id; picker.value = null; result.value = null; editing.value = true }
function swap() { const previous = from.value; from.value = to.value; to.value = previous; if (result.value) calculate() }
function loadScenario(scenario: typeof demoScenarios[number]) { from.value = scenario.from; to.value = scenario.to; mode.value = scenario.mode; sheet.value = null; calculate() }
function toggle(id: string) { expanded.value = expanded.value.includes(id) ? expanded.value.filter(x => x !== id) : [...expanded.value, id] }
function selectRoute(i: number) { selectedRoute.value = i; selectedCombination.value = 0; combinationChosen.value = false; expanded.value = []; detailExpanded.value = []; detailScrollTop.value = 0; sheet.value = null }
function selectDeparture(id: string) {
  const item = candidates.value.find(candidate => candidate.id === id)
  if (!item || id === selectedDeparture.value) return
  selectRoute(item.routeIndex); selectedDeparture.value = item.id
}
function setDeparture(value: DepartureIntent) { departureIntent.value = value; if (result.value) calculate() }
function selectCombination(i: number) { selectedCombination.value = i; combinationChosen.value = true; sheet.value = null }
function routeLabel(item: JourneyRoute) { return item.legs.length ? item.legs.map(l => transitDisplayText(l.lineName).replace('演示', '')).join(' → ') : '站外步行衔接，无需乘车' }
const minutes = (value: number | null) => value === null ? '待补' : Math.ceil(value)
const stopCount = (item: JourneyRoute) => item.legs.reduce((sum, leg) => sum + leg.stopCount, 0)
const outsideCount = (item: JourneyRoute) => (item.accessTransfers?.length ?? 0) + (item.egressTransfers?.length ?? 0) + item.transfers.filter(t => t.kind === 'external').length
function replaceData(next: MetroDataset) {
  datasetGeneration.value++
  backupText.value = ''; backupMessage.value = ''
  for (const key of Object.keys(data)) delete (data as unknown as Record<string, unknown>)[key]
  Object.assign(data, next)
}
function useDataset(kind: 'real' | 'demo') {
  datasetMode.value = kind
  const loadedNext = loadPersonalDataset(kind === 'real' ? fuzhouDataset : demoDataset)
  personalCopyPresent.value = JSON.stringify(loadedNext.dataset) !== JSON.stringify(kind === 'real' ? fuzhouDataset : demoDataset)
  replaceData(loadedNext.dataset)
  personalNotice.value = loadedNext.warning ?? ''
  from.value = kind === 'real' ? data.stations.find(s => s.name === '福州火车站')?.id ?? data.stations[0]?.id ?? '' : 's-west'
  to.value = kind === 'real' ? data.stations.find(s => s.name === '机场')?.id ?? data.stations[data.stations.length - 1]?.id ?? '' : 's-bay'
  sheet.value = null; adoptPublished(); calculate()
}
function applyDataset(next: MetroDataset) {
  maintenanceError.value = ''
  try {
    if (!isDemo.value && next.provenance.kind === 'demo') throw new Error('合成资料只能导入独立演示线网，请先切换线网。')
    savePersonalDataset(isDemo.value ? demoDataset : fuzhouDataset, next)
    personalCopyPresent.value = true
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
function applyFixture(value: string | undefined) {
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
}

const initialized = ref(false)
const departureIntent = ref<DepartureIntent>({kind:'now'})
const detailExpanded = ref<string[]>([])
const detailScrollTop = ref(0)
const timingByRoute = ref<Record<string, JourneyTiming>>({})
const queryWindow = ref(departureWindow(new Date().toISOString()))
const candidateRuns = ref<DepartureCandidate[]>([])
const timetableAvailable = ref(false)
const candidates = computed(() => displayCandidates(result.value?.routes ?? [], candidateRuns.value, queryWindow.value, timetableAvailable.value))
const selectedDeparture = ref('')
const boardPosition = ref({ x: 0, y: 0 })
const routeTiming = computed(() => {
  const selected = candidates.value.find(item => item.id === selectedDeparture.value && item.routeId === route.value?.id)
  return selected?.timing ?? (route.value ? timingByRoute.value[route.value.id] ?? estimatedJourneyTiming(route.value) : undefined)
})

adoptPublished()
return { timetable, datasetMode, loaded, data, personalNotice, maintenanceOpen, maintenanceError, backupText, backupMessage, datasetGeneration, personalCopyPresent, loadOfficialNavigation, openContribution, from, to, dataErrors, isDemo, mode, result, selectedRoute, selectedCombination, combinationChosen, busy, editing, picker, query, sheet, expanded, fixtureApplied, modes, stationName, filteredStations, scenarios, route, currentMode, sheetTitle, errorTitle, errorMessages, actionableErrors, searchLimited, linesForStation, calculate, changeMode, openPicker, chooseStation, swap, loadScenario, toggle, selectRoute, selectCombination, routeLabel, minutes, stopCount, outsideCount, replaceData, useDataset, applyDataset, backupDataset, applyFixture, initialized, departureIntent, detailExpanded, detailScrollTop, timingByRoute, routeTiming, queryWindow, candidateRuns, timetableAvailable, candidates, selectedDeparture, boardPosition, selectDeparture, setDeparture }
}
let session: ReturnType<typeof createJourneySession> | undefined
// The application session outlives any page that first opens it (including reLaunch).
export function useJourneySession() { return session ??= effectScope(true).run(createJourneySession)! }
