<script setup lang="ts">
import { computed, ref } from 'vue'
import type { JourneyRoute, MetroDataset } from '../core/types'
import { arrivalPathFor, compactInstruction, lineInk, positionChoices, recommendationFacilities, transferOverview } from './route-presentation'
import RidePosition from './RidePosition.vue'
import ExternalConnection from './ExternalConnection.vue'
const props = defineProps<{ route: JourneyRoute; dataset: MetroDataset; combinationIndex: number; explicitSelection?: boolean; demo: boolean; destinationName: string }>()
const emit = defineEmits<{ openCombinations: [] }>()
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
        <view class="station-row"><text class="station-name">{{ leg.fromStationName }}</text><text class="station-action">{{ index === 0 ? '起点' : '重新进站' }}</text></view>
      </view>
      <view class="ride-segment">
        <view class="ride-rail" :style="{ backgroundColor: leg.lineColor }"/>
        <view class="ride-header">
          <text class="route-line" :style="{ backgroundColor: leg.lineColor, color: lineInk(leg.lineColor) }">{{ leg.lineName.replace('演示', '') }}</text>
          <button class="stops-button" :aria-label="'第' + (index + 1) + '段途经车站'" :aria-expanded="expanded.includes('stops-' + index)" @tap="toggle('stops-' + index)"><text class="stop-count">{{ leg.stopCount }} 站</text><text>{{ expanded.includes('stops-' + index) ? '−' : '⌄' }}</text></button>
        </view>
        <text class="ride-direction">往 <text class="direction-terminal">{{ leg.direction }}</text></text>
        <view v-if="expanded.includes('stops-' + index)" class="via-list"><text v-for="stop in viaStations(index)" :key="stop.id" class="via-name">{{ stop.name }}</text><text v-if="!viaStations(index).length" class="via-name">下一站即下车站</text><text class="via-name">{{ leg.toStationName }} · 下车</text><text v-if="leg.rideMinutes !== null" class="via-name">行车约 {{ Math.ceil(leg.rideMinutes) }} 分钟{{ demo ? '（演示估算）' : '' }}</text></view>
        <RidePosition :leg="leg" :formation="formation(index)" :choices="positionChoices(route, index, combinationIndex)" :path="path(index)" :demo="demo" :facilities="recommendationFacilities(route, index)" :linked="!!combination">
          <template v-if="index === 0 && origin"><text class="detail-heading">上车前 · 从付费站厅到站台</text><view v-for="(instruction, i) in origin.instructions" :key="i" class="walk-step"><text class="walk-number">{{ i + 1 }}</text><text class="walk-copy">{{ compactInstruction(instruction, leg.fromStationName) }}</text></view></template>
        </RidePosition>
      </view>
      <view class="station-event arrival"><view class="station-dot" :style="{ borderColor: leg.lineColor }"/><view class="station-row"><text class="station-name">{{ leg.toStationName }}</text><text class="station-action">{{ index < route.legs.length - 1 ? '换乘' : '终点 · 下车' }}</text></view></view>
      <view v-if="route.transfers[index]" class="transfer-segment">
        <view class="walk-rail"/>
        <view class="transfer-header"><text class="walk-distance">{{ route.transfers[index].kind === 'external' ? '出站步行' : '步行' }} {{ transferPath(index) ? Math.round(transferPath(index)!.metres) + ' 米 · 约 ' + Math.ceil(transferPath(index)!.minutes) + ' 分钟' : '距离与时间待补' }}</text><button class="details-button" :aria-label="'第' + (index + 1) + '次换乘步骤'" :aria-expanded="expanded.includes('transfer-' + index)" @tap="toggle('transfer-' + index)">步骤 {{ expanded.includes('transfer-' + index) ? '−' : '⌄' }}</button></view>
        <text class="transfer-overview">{{ transferOverview(route.transfers[index], transferPath(index)) }}</text>
        <view v-if="expanded.includes('transfer-' + index)" class="transfer-details">
          <text v-if="combination && route.doorCombinations.length > 1" class="detail-note">{{ explicitSelection ? '当前搭配' : '以下以一组等优搭配为例' }} · 组合 {{ combinationIndex + 1 }}，可在下方切换整程搭配。</text>
          <view v-if="selected(index)" class="walk-step"><text class="walk-number">1</text><text class="walk-copy">从 {{ selected(index)?.car }} 车厢 {{ selected(index)?.door }} 门下车。</text></view>
          <view v-for="(instruction, i) in (transferPath(index)?.instructions ?? route.transfers[index].instructions)" :key="i" class="walk-step"><text class="walk-number">{{ i + (selected(index) ? 2 : 1) }}</text><text class="walk-copy">{{ route.transfers[index].kind === 'external' ? instruction : compactInstruction(instruction, leg.toStationName) }}</text></view>
          <text v-if="combination && selected(index + 1)" class="next-boarding">到 {{ selected(index + 1)?.car }} 车厢 {{ selected(index + 1)?.door }} 门，乘坐下一段。</text>
        </view>
      </view>
    </view>
    <ExternalConnection v-for="(guide, index) in route.egressTransfers" :key="'egress-' + index" :guide="guide"/>
    <view class="destination-section">
      <view class="destination-header"><text class="destination-note">{{ route.egressTransfers?.length || !route.legs.length ? '抵达 ' + destinationName : '前往付费站厅 · 未指定出口' }}</text><button v-if="destination" class="details-button" aria-label="到达后步行步骤" :aria-expanded="expanded.includes('destination')" @tap="toggle('destination')">步骤 {{ expanded.includes('destination') ? '−' : '⌄' }}</button></view>
      <view v-if="destination && expanded.includes('destination')"><view v-for="(instruction, index) in destination.instructions" :key="index" class="walk-step"><text class="walk-number">{{ index + 1 }}</text><text class="walk-copy">{{ compactInstruction(instruction, destinationName) }}</text></view></view>
      <text v-if="!destination && route.legs.length" class="detail-note">站台至站厅指引待补充</text>
    </view>
    <button v-if="route.doorCombinations.length > 1" class="combination-link" aria-label="查看完整推荐车门组合" @tap="emit('openCombinations')"><text>{{ route.doorCombinations.length }} 组等优搭配{{ explicitSelection ? ' · 当前组合 ' + (combinationIndex + 1) : '' }}</text><text>查看整程搭配 ›</text></button>
  </view>
</template>
<style scoped>
.timeline { background: #fff; padding: 0; }
.timeline-leg { min-width: 0; }
.station-event { position: relative; padding: 9px 0 9px 36px; min-height: 48px; }
.station-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.station-name { font-size: 21px; font-weight: 750; line-height: 1.45; color: #24382f; overflow-wrap: anywhere; }
.station-action { font-size: 13px; color: #69766f; }
.station-dot { position: absolute; top: 17px; left: 3px; width: 19px; height: 19px; border: 5px solid; border-radius: 50%; background: #fff; z-index: 1; }
.arrival .station-dot { width: 15px; height: 15px; left: 5px; top: 18px; border-width: 4px; }
.ride-segment { position: relative; padding: 0 0 8px 36px; }
.ride-rail { position: absolute; left: 9px; width: 7px; top: -23px; bottom: -27px; }
.ride-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; }
.route-line { max-width: calc(100% - 65px); padding: 2px 7px; border-radius: 3px; font-size: 17px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.stops-button { min-height: 44px; min-width: 58px; display: flex; align-items: center; justify-content: flex-end; gap: 7px; font-size: 14px; color: #66756c; background: transparent; margin: 0; padding: 6px 0; line-height: 1.5; border-radius: 0; }
.stop-count { font-weight: 650; color: #445b4c; }.ride-direction { display: block; font-size: 16px; line-height: 1.65; color: #465b4f; }.direction-terminal { font-weight: 600; }
.stops-button::after,.details-button::after,.combination-link::after { border: none; }
.via-list { margin: 8px 0; padding-left: 12px; border-left: 1px solid #d4dfd7; }.via-name { display: block; font-size: 14px; line-height: 1.8; color: #607167; overflow-wrap: anywhere; }
.transfer-segment { position: relative; padding: 0 0 16px 36px; }
.walk-rail { position: absolute; top: -15px; bottom: -16px; left: 11px; border-left: 3px dotted #a9b4ad; }
.transfer-header,.destination-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.walk-distance { font-size: 14px; line-height: 1.6; font-weight: 650; color: #4f6556; }
.details-button { min-height: 44px; min-width: 56px; margin: 0; padding: 7px 0 7px 8px; background: transparent; border-radius: 0; font-size: 13px; color: #68766e; line-height: 1.6; display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; }
.transfer-overview { display: block; font-size: 14px; color: #5b6c60; line-height: 1.65; overflow-wrap: anywhere; }
.transfer-details { border-top: 1px solid #e9ede9; margin-top: 10px; padding-top: 8px; }
.detail-note { display: block; font-size: 13px; color: #69776d; line-height: 1.7; overflow-wrap: anywhere; }.detail-heading { font-size: 14px; font-weight: 650; color: #42604c; display: block; margin-top: 12px; }
.walk-step { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; }.walk-number { flex-shrink: 0; min-width: 15px; font-size: 12px; color: #78877a; }.walk-copy { flex: 1; min-width: 0; font-size: 14px; color: #4b6151; line-height: 1.75; overflow-wrap: anywhere; }.next-boarding { display: block; font-size: 14px; color: #345b41; font-weight: 600; line-height: 1.7; margin-top: 10px; }
.destination-section { padding: 0 0 10px 36px; }.destination-note { font-size: 14px; color: #647469; line-height: 1.65; overflow-wrap: anywhere; }
.combination-link { width: 100%; min-height: 48px; margin: 5px 0 0; padding: 10px 0; border-radius: 0; border-top: 1px solid #e8ece9; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 4px 12px; text-align: left; font-size: 13px; color: #42664f; line-height: 1.6; background: transparent; }
@media (max-width: 359px) { .station-event,.ride-segment,.transfer-segment,.destination-section { padding-left: 31px; }.station-name { font-size: 20px; }.route-line { font-size: 16px; } }
</style>
