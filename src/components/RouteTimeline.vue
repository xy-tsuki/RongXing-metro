<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JourneyRoute, MetroDataset } from '../core/types'
import { arrivalPathFor, compactInstruction, facilitiesIn, lineInk, positionChoices } from './route-presentation'
import RidePosition from './RidePosition.vue'
import FacilityLabel from './FacilityLabel.vue'
import ExternalConnection from './ExternalConnection.vue'

const props = defineProps<{ route: JourneyRoute; dataset: MetroDataset; combinationIndex: number; demo: boolean; destinationName: string }>()
const emit = defineEmits<{ selectCombination: [index: number]; openCombinations: [] }>()
const expanded = ref<string[]>([])
const toggle = (id: string) => { expanded.value = expanded.value.includes(id) ? expanded.value.filter(x => x !== id) : [...expanded.value, id] }
const combination = computed(() => props.route.doorCombinations[props.combinationIndex])
const origin = computed(() => combination.value?.originPath ?? props.route.originPath)
const destination = computed(() => combination.value?.destinationPath ?? props.route.destinationPath)
const selected = (index: number) => combination.value?.positions[index] ?? props.route.legs[index]?.recommendations[0]
const path = (index: number) => arrivalPathFor(props.route, index, props.combinationIndex)
const transferPath = (index: number) => combination.value?.transferPaths[index] ?? props.route.transfers[index]?.path
function formation(index: number) {
  const service = props.dataset.services.find(s => s.id === props.route.legs[index].serviceId)
  return props.dataset.formations.find(f => f.id === service?.formationId)
}
function viaStations(index: number) {
  const leg = props.route.legs[index], service = props.dataset.services.find(s => s.id === leg.serviceId)
  if (!service) return []
  return service.stops.slice(service.stops.findIndex(s => s.stationId === leg.fromStationId) + 1, service.stops.findIndex(s => s.stationId === leg.toStationId))
    .map(s => ({ id: s.stationId, name: props.dataset.stations.find(station => station.id === s.stationId)?.name ?? s.stationId }))
}
</script>
<template>
  <view class="timeline" aria-label="逐段乘车与换乘指引">
    <ExternalConnection v-for="(guide, index) in route.accessTransfers" :key="'access-' + index" :guide="guide"/>
    <view v-for="(leg, index) in route.legs" :key="leg.serviceId + '-' + index" class="timeline-leg">
      <view v-if="index === 0 || leg.fromStationId !== route.legs[index - 1].toStationId" class="station-event departure">
        <view class="station-dot" :style="{ borderColor: leg.lineColor }"/>
        <view class="station-row"><text class="station-name">{{ leg.fromStationName }}</text><text class="station-action">{{ index === 0 ? '上车' : '换乘上车' }}</text></view>
      </view>
      <view class="ride-segment">
        <view class="ride-rail" :style="{ backgroundColor: leg.lineColor }"/>
        <view class="ride-header"><text class="route-line" :style="{ backgroundColor: leg.lineColor, color: lineInk(leg.lineColor) }">{{ leg.lineName }}</text><text class="segment-index">第 {{ index + 1 }} 段</text></view>
        <text class="ride-direction">往 <text class="direction-terminal">{{ leg.direction }}</text> 方向</text>
        <button class="stops-button" :aria-label="'第' + (index + 1) + '段途经车站'" :aria-expanded="expanded.includes('stops-' + index)" @tap="toggle('stops-' + index)"><text>乘坐 <text class="stop-count">{{ leg.stopCount }}</text> 站{{ leg.rideMinutes !== null ? ' · 行车约 ' + Math.ceil(leg.rideMinutes) + ' 分钟' : '' }}</text><text class="stops-disclosure">途经站 {{ expanded.includes('stops-' + index) ? '−' : '＋' }}</text></button>
        <view v-if="expanded.includes('stops-' + index)" class="via-list"><text v-for="stop in viaStations(index)" :key="stop.id" class="via-name">{{ stop.name }}</text><text v-if="!viaStations(index).length" class="via-name">下一站即下车站</text><text class="via-name via-destination">{{ leg.toStationName }} · 下车</text></view>
        <text class="alight-target">在 <text class="alight-name">{{ leg.toStationName }}</text> 下车</text>
        <RidePosition :key="leg.serviceId" :leg="leg" :formation="formation(index)" :choices="positionChoices(route, index, combinationIndex)" :selected="selected(index)" :path="path(index)" :transfer="index < route.legs.length - 1" :demo="demo" @select="emit('selectCombination', $event)"/>
        <view v-if="index === 0 && origin" class="boarding-guide"><button class="guide-toggle" :aria-expanded="expanded.includes('origin')" @tap="toggle('origin')"><text>上车前 · 站厅到站台</text><text>{{ expanded.includes('origin') ? '−' : '＋' }}</text></button><view v-if="expanded.includes('origin')" class="walk-steps"><view v-for="(instruction, i) in origin.instructions" :key="i" class="walk-step"><text class="walk-number">{{ i + 1 }}</text><text class="walk-copy">{{ compactInstruction(instruction, leg.fromStationName) }}</text></view></view></view>
      </view>
      <view class="station-event arrival"><view class="station-dot" :style="{ borderColor: leg.lineColor }"/><view class="station-row"><text class="station-name">{{ leg.toStationName }}</text><text class="station-action">{{ index < route.legs.length - 1 ? '下车换乘' : '下车' }}</text></view></view>
      <view v-if="route.transfers[index]" class="transfer-segment">
        <view class="walk-rail"/>
        <view class="transfer-panel">
          <view class="transfer-header"><text class="transfer-label">{{ route.transfers[index].kind === 'external' ? '出站步行换乘' : '站内步行换乘' }}</text><text class="walk-distance">{{ transferPath(index) ? Math.round(transferPath(index)!.metres) + ' 米 · 约 ' + Math.ceil(transferPath(index)!.minutes) + ' 分钟' : '距离与时间待补' }}</text></view>
          <view class="transfer-facilities"><FacilityLabel v-for="kind in facilitiesIn(transferPath(index))" :key="kind" :kind="kind"/><text class="transfer-to">前往 {{ route.transfers[index].toLineName }}</text></view>
          <view class="walk-steps">
            <view v-if="selected(index)" class="walk-step"><text class="walk-number">1</text><text class="walk-copy">从 <text class="walk-strong">{{ selected(index)?.car }} 车厢 {{ selected(index)?.door }} 门</text> 下车。</text></view>
            <view v-for="(instruction, i) in (transferPath(index)?.instructions ?? route.transfers[index].instructions)" :key="i" class="walk-step"><text class="walk-number">{{ i + (selected(index) ? 2 : 1) }}</text><text class="walk-copy">{{ route.transfers[index].kind === 'external' ? instruction : compactInstruction(instruction, leg.toStationName) }}</text></view>
          </view>
          <text v-if="!transferPath(index)" class="transfer-pending">具体设施、车门与通路待核实，请沿现场换乘标识行走。</text>
          <view v-if="combination && selected(index + 1)" class="next-boarding"><text class="next-arrow">↳</text><text>到 <text class="walk-strong">{{ selected(index + 1)?.car }} 车厢 {{ selected(index + 1)?.door }} 门</text>，乘坐下一段。</text></view>
        </view>
      </view>
    </view>
    <ExternalConnection v-for="(guide, index) in route.egressTransfers" :key="'egress-' + index" :guide="guide"/>
    <view class="destination-section"><view class="destination-marker">✓</view><text class="destination-title">{{ route.egressTransfers?.length || !route.legs.length ? '抵达 ' + destinationName : '前往付费站厅' }}</text><view v-if="destination" class="walk-steps"><view v-for="(instruction, index) in destination.instructions" :key="index" class="walk-step"><text class="walk-number">{{ index + 1 }}</text><text class="walk-copy">{{ compactInstruction(instruction, destinationName) }}</text></view></view><text v-else-if="route.legs.length" class="destination-note">站台至站厅的精细指引待补充。</text><text class="destination-note">未指定具体出口</text></view>
    <button v-if="route.doorCombinations.length > 1" class="combination-link" aria-label="查看完整推荐车门组合" @tap="emit('openCombinations')"><text>{{ route.equalChoicesTruncated ? '已展示的' : '共' }} {{ route.doorCombinations.length }} 组整程等优位置 · 当前第 {{ combinationIndex + 1 }} 组</text><text>查看 ＋</text></button>
  </view>
</template>
<style scoped>
.timeline { background: #fff; border: 1px solid #e0e7e3; border-radius: 12px; padding: 8px 14px 0; overflow: hidden; }
.timeline-leg { min-width: 0; }.station-event { position: relative; padding: 12px 0 12px 36px; min-height: 54px; }.station-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }.station-name { font-size: 22px; line-height: 1.45; font-weight: 750; color: #223c35; overflow-wrap: anywhere; word-break: break-all; }.station-action { font-size: 13px; color: #596d65; flex-shrink: 0; }
.station-dot { position: absolute; top: 20px; left: 5px; width: 19px; height: 19px; border: 5px solid; border-radius: 50%; background: #fff; z-index: 1; }.arrival .station-dot { width: 15px; height: 15px; border-width: 4px; left: 7px; }.arrival { padding-top: 10px; padding-bottom: 12px; }.arrival .station-dot { top: 18px; }
.ride-segment { padding: 2px 0 12px 36px; position: relative; }.ride-rail { position: absolute; width: 6px; top: -23px; bottom: -28px; left: 11.5px; border-radius: 4px; }.ride-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 5px 10px; }.route-line { display: inline-block; border-radius: 5px; padding: 4px 8px; font-size: 16px; line-height: 1.5; font-weight: 700; overflow-wrap: anywhere; max-width: 100%; }.segment-index { font-size: 13px; color: #61736b; }.ride-direction { display: block; font-size: 17px; line-height: 1.65; color: #344f44; margin-top: 6px; word-break: break-all; }.direction-terminal { font-weight: 700; }.stops-button { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0 8px; min-height: 44px; width: 100%; padding: 6px 0; border-radius: 0; margin: 0; background: transparent; text-align: left; font-size: 14px; line-height: 1.6; color: #586d63; }.stops-button::after,.guide-toggle::after,.combination-link::after { border: none; }.stop-count { font-weight: 700; color: #334f42; }.stops-disclosure { color: #3c6654; font-size: 13px; padding: 4px 0; }.via-list { margin: 2px 0 12px; padding: 0 12px; border-left: 2px solid #d8e3dd; }.via-name { display: block; font-size: 14px; line-height: 1.8; color: #5a6e65; padding: 3px 0; overflow-wrap: anywhere; }.via-destination { font-weight: 650; color: #294c3c; }.alight-target { display: block; font-size: 15px; color: #52685d; line-height: 1.65; word-break: break-all; }.alight-name { font-weight: 700; color: #2c483c; }
.guide-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px; margin: 0; padding: 8px 0; border-radius: 0; text-align: left; font-size: 14px; line-height: 1.5; color: #52695e; background: transparent; }.boarding-guide { margin-top: 2px; }.boarding-guide .walk-steps { padding-bottom: 8px; }
.transfer-segment { position: relative; padding: 0 0 16px 36px; }.walk-rail { position: absolute; top: -15px; bottom: -10px; left: 13px; width: 0; border-left: 3px dotted #a8b5ae; }.transfer-panel { border-radius: 8px; padding: 12px; background: #f4f5f3; border: 1px solid #e2e6e1; }.transfer-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 10px; }.transfer-label { font-size: 15px; font-weight: 700; color: #3c5148; }.walk-distance { font-size: 13px; color: #5c6e64; font-weight: 550; }.transfer-facilities { display: flex; flex-wrap: wrap; gap: 8px 12px; margin: 10px 0 0; align-items: center; }.transfer-to { font-size: 14px; font-weight: 600; color: #385b49; word-break: break-all; }.walk-steps { margin-top: 9px; }.walk-step { display: flex; gap: 8px; align-items: baseline; margin-top: 8px; }.walk-number { color: #526d5c; background: #e7ece7; border-radius: 50%; width: 20px; height: 20px; line-height: 20px; text-align: center; font-size: 12px; flex-shrink: 0; }.walk-copy { flex: 1; min-width: 0; font-size: 14px; line-height: 1.75; color: #425b4c; overflow-wrap: anywhere; }.walk-strong { font-weight: 700; color: #244c38; }.transfer-pending { display: block; font-size: 13px; line-height: 1.75; color: #6c644f; margin-top: 10px; }.next-boarding { display: flex; gap: 7px; font-size: 14px; line-height: 1.7; margin-top: 12px; padding-top: 10px; border-top: 1px solid #dbe2d9; color: #3b5b48; }.next-arrow { font-weight: 700; }
.destination-section { position: relative; padding: 12px 0 16px 36px; border-top: 1px solid #e8ece8; }.destination-marker { position: absolute; left: 4px; top: 17px; width: 22px; height: 22px; line-height: 22px; text-align: center; background: #e6f0e9; color: #176b52; border-radius: 50%; font-size: 13px; font-weight: 700; }.destination-title { font-size: 17px; font-weight: 650; line-height: 1.65; color: #29483b; word-break: break-all; }.destination-note { display: block; font-size: 13px; line-height: 1.7; color: #617166; margin-top: 5px; }.combination-link { min-height: 52px; width: 100%; padding: 10px 0; margin: 0; background: transparent; border-radius: 0; border-top: 1px solid #e5ece6; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 6px; text-align: left; font-size: 13px; line-height: 1.6; color: #375f49; }
@media (max-width: 359px) { .timeline { padding-left: 10px; padding-right: 10px; }.station-event,.ride-segment,.transfer-segment,.destination-section { padding-left: 31px; }.station-name { font-size: 21px; }.route-line { font-size: 15px; }.transfer-panel { padding: 10px; } }
</style>
