<script setup lang="ts">
import { transitDisplayText } from '../navigation/line-display'
import { computed, onMounted, onUnmounted, nextTick, getCurrentInstance, ref, watch } from 'vue'
import { useJourneySession } from '../navigation/session'
import { lineInk } from './route-presentation'
import RouteTimeline from './RouteTimeline.vue'
import RouteSearch from './RouteSearch.vue'
import RouteChoices from './RouteChoices.vue'
import ModeSelector from './ModeSelector.vue'
import JourneyTime from './JourneyTime.vue'
import JourneyFare from './JourneyFare.vue'
import { farePresentation } from '../navigation/fare-presentation'
import BrandLogo from './BrandLogo.vue'
import { scheduleScope, calendarGapNote } from '../navigation/schedule-presentation'
import { navigationLayout, moveEditBelow } from '../navigation/navigation-layout'
import StationPicker from './StationPicker.vue'
const props=withDefaults(defineProps<{stage?:'search'|'options'|'details';fixture?:string}>(),{stage:'search'})
const developerTools = import.meta.env.DEV
const miniLayout = ref<ReturnType<typeof navigationLayout> | null>(null)
const headerHeight = ref(0)
const headerInstance = getCurrentInstance()
function readMiniLayout() {
  // #ifdef MP-WEIXIN
  const info = typeof uni.getWindowInfo === 'function' ? uni.getWindowInfo() : uni.getSystemInfoSync()
  let menu: ReturnType<typeof uni.getMenuButtonBoundingClientRect> | undefined
  try { menu = uni.getMenuButtonBoundingClientRect() } catch { /* Conservative inset until the API is available. */ }
  miniLayout.value = navigationLayout(info,menu)
  void nextTick(() => uni.createSelectorQuery().in(headerInstance?.proxy).select('.page-navigation').boundingClientRect((rect:any)=>{if(rect?.height)headerHeight.value=rect.height}).exec())
  // #endif
}
readMiniLayout()
onMounted(()=>{readMiniLayout();uni.onWindowResize(readMiniLayout)})
onUnmounted(()=>uni.offWindowResize(readMiniLayout))

const { timetable, datasetMode, loaded, data, personalNotice, backupText, backupMessage, datasetGeneration, personalCopyPresent, loadOfficialNavigation, openContribution, from, to, dataErrors, isDemo, mode, result, selectedRoute, selectedCombination, combinationChosen, busy, editing, picker, query, sheet, expanded, fixtureApplied, modes, stationName, filteredStations, scenarios, route, currentMode, sheetTitle, errorTitle, errorMessages, actionableErrors, searchLimited, linesForStation, calculate, changeMode, openPicker, chooseStation, swap, loadScenario, toggle, selectRoute, selectCombination, routeLabel, minutes, stopCount, outsideCount, replaceData, useDataset, backupDataset, applyFixture, initialized, departureIntent, detailExpanded, detailScrollTop, timingByRoute, routeTiming, queryWindow, timetableAvailable, candidates, selectedDeparture, boardPosition, selectDeparture, setDeparture }=useJourneySession()
onMounted(()=>{ if(!initialized.value){initialized.value=true;void loadOfficialNavigation(true)} })
const editBelow = computed(()=>!!miniLayout.value && moveEditBelow(miniLayout.value,stationName(from.value),stationName(to.value)))
watch([()=>props.stage,()=>stationName(from.value),()=>stationName(to.value)],readMiniLayout)
const navigationStyle = computed(()=>miniLayout.value ? {
  paddingTop:miniLayout.value.status+'px', '--rx-nav-row':miniLayout.value.barHeight+'px',
  '--rx-menu-reserve':miniLayout.value.reserve+'px','--rx-page-gutter':miniLayout.value.gutter+'px',
} : {})
const queryLines = computed(() => [...new Set(result.value?.routes.flatMap(route => route.legs.map(leg => leg.lineId)) ?? [])])
const journeyFare = computed(() => dataErrors.value.length ? null : farePresentation({cityId:data.city.id, networkVersion:data.version, from:from.value, to:to.value, route:route.value, demo:isDemo.value}))
const fareStationNames = computed(() => Object.fromEntries(data.stations.map(station => [station.id, station.name])))
const fareExpanded = ref(false)
watch([from, to, selectedDeparture], () => { fareExpanded.value = false })
watch(()=>props.fixture,applyFixture,{immediate:true})
function updateMode(value: import('../core/types').RouteMode){changeMode(value);uni.pageScrollTo({scrollTop:0,duration:120})}
function startSearch(){calculate();uni.navigateTo({url:'/pages/routes/index'})}
function openDetails(id:string){if(!candidates.value.some(item=>item.id===id))return;selectDeparture(id);if(route.value)uni.navigateTo({url:'/pages/journey/index'})}
function back(){if(getCurrentPages().length>1)uni.navigateBack();else uni.reLaunch({url:'/pages/index/index'})}
function returnSearch(){const pages=getCurrentPages();if(pages.length>1)uni.navigateBack({delta:pages.length-1});else uni.reLaunch({url:'/pages/index/index'})}
function openTimetable(){uni.navigateTo({url:'/pages/timetable/index'})}
</script>

<template>
  <view :class="['app-shell','stage-'+stage]" :style="miniLayout?{'--rx-header-bottom':headerHeight+'px'}:{}">
    <view :class="['page-navigation',{'mini-navigation':miniLayout,'edit-below':editBelow}]" :style="navigationStyle">
    <view v-if="stage==='search'" class="search-topbar"><view class="brand"><BrandLogo/><view class="brand-copy"><text class="brand-name">榕乘</text></view></view></view>
    <view v-else class="level-header"><button class="back-control" aria-label="返回上一页" @tap="back">←</button><view class="level-title"><text>{{stationName(from)}} → {{stationName(to)}}</text><text class="level-subtitle">{{stage==='options'?'路线方案':'精细导航'}} · {{currentMode.name}}</text></view><button class="quiet-menu" aria-label="修改查询" @tap="returnSearch">修改</button></view>
    </view>
    <view v-if="personalNotice && !personalNotice.startsWith('当前使用后台已审核')" class="notice personal-notice">{{personalNotice}}</view>
    <RouteSearch v-if="stage==='search'" :from="stationName(from)" :to="stationName(to)" :mode="mode" :busy="busy" :departure="departureIntent" @pick="openPicker" @swap="swap" @mode="changeMode" @departure="setDeparture" @search="startSearch"/>
    <template v-else>
      <view v-if="stage==='options'" class="sticky-modes"><ModeSelector :model-value="mode" @update:model-value="updateMode"/></view>
      <text v-if="stage==='options'&&mode==='few-stairs'" class="mode-description">优先扶梯与电梯，仍可能含楼梯，以方案为准。</text>
      <view v-if="!result" class="empty-card"><text class="empty-title">先选择这一程的起终点</text><button class="secondary-button" @tap="returnSearch">返回路线搜索</button></view>
      <view v-else-if="!route" class="empty-card"><text class="empty-title">{{from===to && journeyFare ? '同站进出' : errorTitle}}</text><text v-for="(message,i) in actionableErrors" :key="i" class="empty-message">{{message}}</text><JourneyFare v-if="from===to" :value="journeyFare" :station-names="fareStationNames" /><button v-if="mode==='elevator'" class="secondary-button" @tap="changeMode('shortest')">切换为最短路线</button><button class="secondary-button" @tap="returnSearch">修改起终点</button></view>
      <template v-else-if="stage==='options'">
        <RouteChoices :candidates="candidates" :current="selectedDeparture" :window="queryWindow" :timed="timetableAvailable" :demo="isDemo" :city-id="data.city.id" :network-version="data.version" :from-station-id="from" :to-station-id="to" :schedule-scope="scheduleScope(queryLines,timetable.trips)" :calendar-note="calendarGapNote(queryLines,queryWindow.startAt,timetable.trips)" :position="boardPosition" @update:position="boardPosition=$event" @open="openDetails"/>
      </template>
      <template v-else>
        <view class="detail-summary"><view class="detail-summary-main"><text class="detail-count">{{stopCount(route)}} 站 · {{route.transferCount?'换乘 '+route.transferCount+' 次':'直达'}}<template v-if="journeyFare"> · {{journeyFare.quote.amount}} 元</template></text><text class="detail-provenance">{{isDemo?'合成演示，不用于真实乘车':'福州运营线网'}}{{route.walkingMetres!==null?' · 步行 '+Math.round(route.walkingMetres)+' 米':''}}</text></view><button v-if="journeyFare" class="subtle-link" aria-label="查看票价说明" :aria-expanded="fareExpanded" @tap="fareExpanded=!fareExpanded">计费说明 {{fareExpanded?'⌃':'⌄'}}</button></view>
        <JourneyFare v-if="journeyFare && fareExpanded" :key="from+'-'+to" :value="journeyFare" :station-names="fareStationNames" explanation-only :open="fareExpanded" />
        <JourneyTime v-if="routeTiming?.route?.departureAt||routeTiming?.route?.arrivalAt" kind="route" :value="routeTiming?.route"/>
        <view v-if="route.granularity!=='detailed' && mode==='elevator'" class="coverage-note"><text class="coverage-title">连续无障碍指引待核实</text><text class="coverage-detail">{{isDemo?'演示通路资料不完整，以下仅为基础路线。':'福州电梯全覆盖；具体连续通路未核实，以下仅为基础乘车路线。'}}</text></view>
        <view v-if="searchLimited" class="notice">候选范围未全部比较，详情见规划依据。</view>
        <view v-if="mode==='few-stairs'&&route.stairCount" class="coverage-note">此方案仍含 {{route.stairCount}} 级普通楼梯，当前模式优先减少楼梯，并非保证零楼梯。</view>
        <RouteTimeline :key="route.id+'-'+mode" :route="route" :dataset="data" :combination-index="selectedCombination" :explicit-selection="combinationChosen" :demo="isDemo" :destination-name="stationName(to)" :timing="routeTiming" :expanded-keys="detailExpanded" :mode="mode" @update:expanded-keys="detailExpanded=$event" @open-combinations="sheet='doors'"/>
        <view v-if="route.equalChoicesTruncated" class="notice">等优组合较多，当前仅展示部分组合。</view>
        <text v-if="isDemo" class="estimate-note">班次与候车时间均为模拟，仅演示界面，不用于真实乘车。</text>
        <button class="utility-button" @tap="toggle('diagnostics')"><text>规划依据与数据边界</text><text>{{expanded.includes('diagnostics')?'−':'＋'}}</text></button><view v-if="expanded.includes('diagnostics')" class="notice"><text v-for="(message,i) in result.diagnostics" :key="i" class="diagnostic-line">{{transitDisplayText(message)}}</text></view>
      </template>
    </template>
    <text v-if="personalNotice.startsWith('当前使用后台已审核')" class="reviewed-note">已载入审核资料 · 本机副本保留</text><view class="more-tools"><button class="utility-button" aria-label="更多功能" @tap="toggle('tools')"><text>数据与采集</text><text>{{expanded.includes('tools')?'−':'＋'}}</text></button><view v-if="expanded.includes('tools')"><button class="utility-button" @tap="openContribution">协作采集与资料审核 ›</button><button v-if="developerTools" class="utility-button" @tap="sheet='scenarios'">切换线网与演示场景 ›</button><button class="utility-button" @tap="sheet='network'">运营线网 ›</button></view></view>
    <view class="page-footer">榕乘 · 每一程，从容一点</view>
    <view class="test-footer" aria-label="时刻表与规划说明"><template v-if="!isDemo"><text class="test-footer-title">时刻表说明</text><text class="test-footer-copy">班次含推算，非实时信息；缺失的换乘时间使用预设。</text><button class="test-footer-link" @tap="openTimetable">查看各站全天时刻 ›</button></template><button class="test-footer-link" @tap="sheet='data'">数据与规划说明 ›</button></view>
    <StationPicker v-if="picker" :key="picker" :dataset="data" :endpoint="picker" :selected-id="picker === 'from' ? from : to" :demo="isDemo" @close="picker = null" @choose="chooseStation"/>

    <view v-if="sheet" class="modal-backdrop" @tap="sheet = null"><view class="modal-sheet" @tap.stop>
      <view class="modal-header"><text class="modal-title">{{ sheetTitle }}</text><button class="close-button" aria-label="关闭弹窗" @tap="sheet = null">×</button></view>
      <scroll-view scroll-y class="sheet-scroll">
        <template v-if="developerTools && sheet === 'scenarios'"><button class="scenario-item" @tap="useDataset('real')"><text class="scenario-name">福州真实运营线网 {{ !isDemo ? '✓' : '' }}</text><text class="scenario-stations">已核对运营范围；站内设施与车门逐站补充。</text></button><button class="scenario-item" @tap="useDataset('demo')"><text class="scenario-name">独立合成演示线网 {{ isDemo ? '✓' : '' }}</text><text class="scenario-stations">测试车门推荐、三种模式和单站资料录入。</text></button><text v-if="isDemo" class="sheet-description">以下场景全部为合成数据。</text><button v-for="scenario in scenarios" :key="scenario.id" class="scenario-item" @tap="loadScenario(scenario)"><text class="scenario-name">{{ scenario.title }}</text><text class="scenario-stations">{{ stationName(scenario.from) }} → {{ stationName(scenario.to) }}</text></button></template>
        <template v-if="sheet === 'routes' && result"><button v-for="(item, i) in result.routes" :key="item.id" :class="['route-option', { selected: selectedRoute === i }]" @tap="selectRoute(i)"><view class="choice-heading"><text class="option-title">{{ i === 0 ? '推荐方案' : '备选方案 ' + (i + 1) }}</text><text v-if="selectedRoute === i" class="selected-check">✓</text></view><text class="option-metrics">{{ item.totalMinutes === null ? stopCount(item) + ' 站' : '约 ' + minutes(item.totalMinutes) + ' 分钟' }} · {{ item.transferCount ? item.transferCount + ' 次换乘' : '直达' }}</text><text class="option-lines">{{ routeLabel(item) }}</text><text class="option-detail">{{ outsideCount(item) ? '含 ' + outsideCount(item) + ' 段出站步行' : item.transferCount ? '乘车段之间均为站内换乘' : '无需换乘' }}</text><text class="option-detail">{{ item.walkingMetres === null ? '站内距离与楼梯待采集' : '步行 ' + Math.round(item.walkingMetres) + ' 米 · ' + item.stairCount + ' 级普通楼梯' }}</text></button></template>
        <template v-if="sheet === 'doors' && route"><text class="sheet-description">每组都是完整行程的等价推荐。选择后，各段车门与步行指引一起更新。</text><button v-for="(choice, ci) in route.doorCombinations" :key="ci" :class="['combination-button', { chosen: combinationChosen && selectedCombination === ci }]" @tap="selectCombination(ci)"><view class="choice-heading"><text class="combination-title">组合 {{ ci + 1 }}</text><text v-if="combinationChosen && selectedCombination === ci" class="selected-check">已选 ✓</text></view><view v-for="(position, pi) in choice.positions" :key="pi" class="combination-leg"><text class="combination-line">第 {{ pi + 1 }} 段 · {{ transitDisplayText(route.legs[pi].lineName) }}</text><text class="combination-position">{{ position.car }} 号车厢 · {{ position.door }} 号门</text></view></button></template>
        <template v-if="sheet === 'network'"><view v-for="line in data.lines" :key="line.id" class="network-line"><text class="line-badge" :style="{ background: line.color, color: lineInk(line.color) }">{{ transitDisplayText(line.name) }}</text><text class="network-stations">{{ data.services.find(s => s.lineId === line.id)?.stops.map(s => stationName(s.stationId)).join(' — ') }}</text><text class="sheet-description">{{ data.formations.find(f => f.id === data.services.find(s => s.lineId === line.id)?.formationId)?.cars }} 节编组</text></view><text class="sheet-description">{{ isDemo ? '独立演示数据，与真实线网隔离。' : '包含站内换乘及两组出站换乘。未开放、预留、在建站点不参与规划。' }}</text></template>
        <template v-if="sheet === 'data'"><view class="notice">{{ isDemo ? '合成演示数据，不用于真实导航。' : '线网已录入；真实站内节点和车门尚待采集，不套用模拟布局。' }}</view><text class="info-body">{{ transitDisplayText(data.description) }}</text><text class="info-heading">车门与通行路径一起计算</text><text class="info-body">最近路线优先缩短步行；少走楼梯优先扶梯和电梯；仅限电梯使用已确认的连续电梯及无障碍通道。按福州电梯全覆盖的前提设计，覆盖声明不能代替具体通路核实。</text><text class="info-heading">协作采集与数据边界</text><text class="info-body">通过“协作采集与资料审核”，按车站、线路和运行方向填写设施或换乘信息，未知内容留空，提交后由维护者审核。只有已录入并核实的通路参与精细推荐。未指定出口；按已收录时刻表匹配班次，不提供实时定位。</text><text class="info-heading">当前数据包</text><text class="info-body">{{ data.version }} · 协议 {{ data.schemaVersion }}。核对来源和日期详见项目 docs/network-sources.md。6号线与滨海快线为4节，其余6节；未提供每车门数和编号。</text></template>
        <template v-if="developerTools && sheet === 'data'"><text class="info-heading">完整资料备份</text><text class="info-body">已经合并的本机资料可导出完整数据，升级前请保留备份。</text><button class="secondary-button" @tap="backupDataset">复制当前完整数据备份</button><text v-if="backupMessage" class="info-body">{{ backupMessage }}</text><textarea v-if="backupText" :value="backupText" :maxlength="-1" class="backup-text" aria-label="完整数据备份"/></template>
      </scroll-view>
    </view></view>
  </view>

</template>
<style scoped>
.detail-summary-main { flex: 1; min-width: 0; }
.detail-summary .subtle-link { flex-shrink: 0; white-space: nowrap; }

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
.test-footer { border-top: 1px solid #e7ece8; padding: 16px 0 calc(24px + env(safe-area-inset-bottom)); color: #65776b; }.test-footer-title { display: block; font-size: 14px; font-weight: 600; line-height: 1.7; }.test-footer-copy { display: block; font-size: 13px; line-height: 1.8; margin-top: 5px; }.test-footer-link { min-height: 44px; padding: 10px 0; margin: 6px 0 0; background: transparent; font-size: 14px; color: #38664e; text-align: left; }.test-footer-link::after { border: none; }
.notice { border: 1px solid #e0d6b5; background: #f3eedf; color: #69562e; font-size: 14px; line-height: 1.75; padding: 12px; border-radius: 9px; margin-bottom: 14px; }
.diagnostic-line { display: block; margin-top: 8px; word-break: break-all; }
.empty-card { background: #fff; border: 1px solid #dce5d3; border-radius: 12px; padding: 20px 17px; margin: 12px 0; }
.empty-title { display: block; font-size: 20px; line-height: 1.5; font-weight: 650; margin-bottom: 14px; }
.empty-message { display: block; font-size: 15px; color: #526348; line-height: 1.8; margin-top: 10px; word-break: break-all; }
.modal-backdrop { position: fixed; top: 0; right: 0; bottom: 0; left: 0; z-index: 100; background: #142b2466; display: flex; align-items: flex-end; justify-content: center; padding: 10px; }
.modal-sheet { width: 100%; max-width: 540px; background: #ffffff; border-radius: 22px; padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); max-height: 90vh; box-shadow: 0 8px 30px #17342318; }
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; }
.modal-title { font-size: 21px; font-weight: 700; flex: 1; line-height: 1.5; }
.close-button { width: 48px; height: 48px; min-height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-size: 28px; color: #486141; background: #eaf1e1; flex-shrink: 0; }
.sheet-scroll { height: 58vh; width: 100%; }
.station-list { height: 49vh; }
.station-search { height: 52px; width: 100%; font-size: 16px; padding: 10px 13px; border: 1px solid #c9d9bb; border-radius: 9px; background: #f4f7f5; color: #25472f; }
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
.combination-button.chosen { border-color: #b4cdbb; background: #f1f7f3; padding: 15px; }
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

<style scoped>
.reviewed-note{display:block;font-size:12px;color:#859187;line-height:1.7;margin-top:15px}.search-topbar{display:flex;align-items:center;gap:10px;min-height:60px}.search-topbar .city-tag{margin-left:auto}.quiet-menu{min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;margin:0;padding:4px;background:transparent;font-size:14px;color:#62796a;border-radius:0}.quiet-menu::after,.back-control::after,.subtle-link::after{border:none}.level-header{display:flex;align-items:center;gap:8px;min-height:76px;padding:8px 0}.back-control{min-width:44px;min-height:48px;display:flex;align-items:center;justify-content:flex-start;margin:0;padding:0;background:transparent;border-radius:0;font-size:29px;color:#597562}.level-title{flex:1;min-width:0;font-size:18px;font-weight:650;line-height:1.5;overflow-wrap:anywhere}.level-title>text{display:block}.level-subtitle{font-size:12px;font-weight:400;color:#7b8980;margin-top:3px}.sticky-modes{position:sticky;top:0;z-index:20;background:#fff}.stage-search{min-height:100vh}.stage-search .more-tools{margin-top:16px}.personal-notice{font-size:13px;margin-top:8px}.detail-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:20px 0 18px}.detail-count{display:block;font-size:20px;font-weight:700;color:#314c3b}.detail-provenance{display:block;font-size:12px;color:#78867b;line-height:1.7;margin-top:4px}.subtle-link{min-height:44px;min-width:60px;display:flex;align-items:center;margin:0;padding:5px 0 5px 8px;font-size:13px;color:#456f53;background:transparent;border-radius:0}.stage-options .more-tools{margin-top:20px}
</style>

<style scoped>
.brand-copy{display:flex;align-items:baseline;flex-wrap:wrap;gap:0 5px;min-width:0}.search-topbar .brand{flex-shrink:1;min-width:0}
/* Only MP-WEIXIN receives these classes/insets; the existing H5 headers keep their layout. */
.mini-navigation{position:sticky;top:0;z-index:40;background:#fff;margin:0 calc(-1 * var(--rx-page-gutter));padding-left:var(--rx-page-gutter);padding-right:var(--rx-page-gutter)}
.mini-navigation .search-topbar{min-height:var(--rx-nav-row);padding-right:var(--rx-menu-reserve);padding-top:4px;padding-bottom:4px}
.mini-navigation .level-header{min-height:var(--rx-nav-row);padding:0 var(--rx-menu-reserve) 0 0;align-items:flex-start}
.mini-navigation .back-control{height:var(--rx-nav-row);min-height:44px;align-items:center}
.mini-navigation .level-title{padding-top:6px;padding-bottom:6px}.mini-navigation .quiet-menu{min-height:var(--rx-nav-row)}
.mini-navigation.edit-below .level-header{position:relative;min-height:calc(var(--rx-nav-row) + 36px);padding-bottom:0}
.mini-navigation.edit-below .quiet-menu{position:absolute;right:0;bottom:0;min-height:36px;padding:4px 0;}
.sticky-modes{top:var(--rx-header-bottom,0px)}
</style>
