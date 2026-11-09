<script setup lang="ts">
import { hourlyDepartures } from '../../navigation/hourly-timetable'
import { transitDisplayText } from '../../navigation/line-display'
import { computed, ref, watch } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { fuzhouDataset } from '../../data/fuzhou'
import { testTimetable as bundledTimetable, stationDayDepartures } from '../../navigation/test-timetable'
import { serviceClassLabels } from '../../navigation/service-class'
import { scheduleLabel, scheduleScope, calendarGapNote, TIMETABLE_SOURCE_NOTICE } from '../../navigation/schedule-presentation'
import { serviceDayLabel } from '../../navigation/service-calendar'
import { publishedData, dataUpdateStatus } from '../../data/published'
const testTimetable = computed(() => publishedData.value?.timetable ?? bundledTimetable)
const network = computed(() => publishedData.value?.dataset ?? fuzhouDataset)
const lines = computed(() => network.value.lines.filter(l => testTimetable.value.stations.some(s => s.lineId === l.id)))
const lineIndex = ref(0), stationIndex = ref(0), directionIndex = ref(0)
const date = ref(new Date(Date.now() + 480 * 60_000).toISOString().slice(0, 10))
const stations = computed(() => testTimetable.value.stations.filter(s => s.lineId === (lines.value[lineIndex.value]?.id ?? '')).sort((a, b) => a.order - b.order))
const directions = computed(() => network.value.services.filter(s => s.lineId === (lines.value[lineIndex.value]?.id ?? '')))
const rows = computed(() => stationDayDepartures(stations.value[stationIndex.value]?.id, directions.value[directionIndex.value]?.id, date.value, testTimetable.value))
const hours = computed(() => hourlyDepartures(rows.value))
function showRun(hour: number, row: typeof rows.value[number]) { uni.showModal({title:`${String(hour).padStart(2,'0')}:${String(Math.floor(row.seconds/60)%60).padStart(2,'0')}`,content:`${serviceClassLabels[row.type]} · ${scheduleLabel(row.schedule)}\n${testTimetable.value.notice}`,showCancel:false,confirmText:'知道了'}) }
const lineScope = computed(() => scheduleScope([lines.value[lineIndex.value]?.id ?? ''], testTimetable.value.trips))
const calendarNote = computed(() => calendarGapNote([(lines.value[lineIndex.value]?.id ?? '')],`${date.value}T12:00:00+08:00`, testTimetable.value.trips))
const daySeconds = computed(() => date.value === new Date(Date.now() + 480 * 60_000).toISOString().slice(0, 10) ? (Date.now() + 480 * 60_000) % 86400_000 / 1000 : -1)
watch(testTimetable, () => { lineIndex.value=0;stationIndex.value=0;directionIndex.value=0 })
watch(lineIndex, () => { stationIndex.value = 0; directionIndex.value = 0 })
onLoad(options => {
  if (options?.station) {
    const match = testTimetable.value.stations.find(s => s.id === options.station)
    if (match) { lineIndex.value = lines.value.findIndex(l => l.id === match.lineId); stationIndex.value = stations.value.findIndex(s => s.id === match.id) }
  }
})
const choose = (e: any) => Number(e.detail.value)
</script>
<template>
  <view class="timetable-page">
    <text class="title">各站全天发车表</text>
    <text class="label">出行日期</text><picker mode="date" :value="date" @change="date=$event.detail.value"><view class="select">{{date}} ▾</view></picker>
    <text class="source-note">日期类型：{{serviceDayLabel(date)}}</text>
    <text class="label">线路</text><picker :range="lines.map(l=>transitDisplayText(l.name))" :value="lineIndex" @change="lineIndex=choose($event)"><view class="select">{{transitDisplayText(lines[lineIndex]?.name ?? '')}} ▾</view></picker>
    <text class="label">车站</text><picker :range="stations.map(s=>s.name)" :value="stationIndex" @change="stationIndex=choose($event)"><view class="select">{{stations[stationIndex]?.name}} ▾</view></picker>
    <text class="label">运行方向</text><picker :range="directions.map(s=>'往'+s.direction)" :value="directionIndex" @change="directionIndex=choose($event)"><view class="select">往{{directions[directionIndex]?.direction}} ▾</view></picker>
    <text class="source-note">{{lineScope}} · {{testTimetable.notice}}</text>
    <text class="count">全天 {{rows.length}} 班 · 24:XX 表示此运营日的次日凌晨</text>
    <text v-if="!rows.length" class="empty">{{calendarNote || '该日期或站点暂未收录时刻；不代表实际停运。'}}</text>
    <template v-if="rows.length"><text class="hour-hint">左侧为小时，右侧为分钟 · 点分钟查看车次说明</text><view class="time-legend"><text>普通</text><text class="limited-express">快 · 大站快车</text><text class="direct-express">直 · 直达快车</text></view></template>
    <view v-for="hour in hours" :key="hour.hour" class="hour-row"><view class="hour-label"><text>{{hour.label}}</text><text v-if="hour.hour>=24" class="next-day">次日</text></view><view class="hour-minutes"><button v-for="row in hour.departures" :key="row.tripId" :class="['minute',row.type,{past:row.seconds<daySeconds}]" :aria-label="hour.label+'点'+row.minute+'分，'+serviceClassLabels[row.type]+'，'+scheduleLabel(row.schedule)" @tap="showRun(hour.hour,row)"><text>{{row.minute}}</text><text v-if="row.type!=='local'" class="minute-type">{{row.type==='limited-express'?'快':'直'}}</text></button></view></view>
    <text class="version">{{dataUpdateStatus}} · {{publishedData?.version.slice(0,12) || '随包版本'}}</text>
    <text class="version">{{testTimetable.version}} · {{lines.length}}线{{testTimetable.trips.length}}班 / {{testTimetable.trips.reduce((sum, trip) => sum + trip.stops.length, 0)}}条停站</text>
    <view class="test-footer">{{testTimetable.notice}} 班次按已发布日历匹配；未知年份不猜测日期类型。时刻不是实时到站。</view>
  </view>
</template>
<style scoped>
.hour-hint{display:block;font-size:13px;line-height:1.7;color:#546b60}.time-legend{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:12px;color:#546b60;margin:9px 0 15px}.limited-express{color:#a64c00}.direct-express{color:#b52932}.hour-row{display:flex;align-items:stretch;border-bottom:1px solid #e2e9e5;min-height:58px}.hour-label{flex:0 0 46px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#176b52;color:#fff;margin:7px 8px 7px 0;border-radius:8px;font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}.next-day{font-size:10px;font-weight:400}.hour-minutes{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-content:center;gap:2px 4px;padding:6px 0}.minute{position:relative;display:flex;align-items:center;justify-content:center;flex:0 0 44px;height:44px;min-height:44px;margin:0;padding:0 0 4px;border-radius:5px;background:transparent;font-size:22px;font-weight:550;line-height:1.2;font-variant-numeric:tabular-nums}.minute::after{border:0}.minute-type{position:absolute;bottom:0;right:3px;font-size:10px;font-weight:650}.minute.past{opacity:1;color:#708177}.minute.limited-express{color:#a64c00}.minute.direct-express{color:#b52932}

.timetable-page{max-width:540px;margin:auto;padding:20px 18px 44px;box-sizing:border-box;color:#294d3b;font-size:15px}.title{display:block;font-size:25px;font-weight:700;margin:4px 0 14px}.test-notice{background:#fff4dd;border:1px solid #ead4a7;color:#77541e;padding:12px;border-radius:10px;font-size:13px;line-height:1.8}.label{display:block;font-size:14px;margin:17px 0 7px;line-height:1.7}.select{padding:13px;background:#f1f6f3;border-radius:9px;min-height:46px;box-sizing:border-box}.count{display:block;margin:22px 0 12px;font-size:13px;line-height:1.7;color:#597565}.run{display:flex;align-items:center;gap:15px;border-top:1px solid #e4ebe7;padding:13px 2px}.clock{font-size:22px;font-weight:650;min-width:94px;font-variant-numeric:tabular-nums}.run-info{min-width:0}.run-info text{display:block;font-size:14px}.run-info .trip-id{font-size:11px;color:#6a8174;overflow-wrap:anywhere;margin-top:3px}.past{opacity:.65}.empty{display:block;padding:25px 0;color:#6a8174;line-height:1.8}.version{display:block;font-size:12px;color:#6a8174;margin-top:24px;overflow-wrap:anywhere}
</style>
<style scoped>
.test-footer { margin-top: 20px; padding-top: 14px; border-top: 1px solid #e4ebe7; color: #65776b; font-size: 13px; line-height: 1.8; }
.source-note { display:block; margin-top:16px; color:#597565; font-size:13px; line-height:1.8; }
</style>

