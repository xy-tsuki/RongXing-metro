<script setup lang="ts">
import { transitDisplayText } from '../navigation/line-display'
import { computed, ref } from 'vue'
import type { MetroDataset } from '../core/types'
import { stationsOnLine } from '../navigation/station-selection'
import { lineInk } from './route-presentation'
const props = defineProps<{ dataset: MetroDataset; endpoint: 'from' | 'to'; selectedId: string; demo: boolean }>()
const emit = defineEmits<{ close: []; choose: [stationId: string] }>()
const lineId = ref<string | null>(null)
const query = ref('')
const line = computed(() => props.dataset.lines.find(item => item.id === lineId.value))
const stations = computed(() => lineId.value ? stationsOnLine(props.dataset, lineId.value) : [])
const filtered = computed(() => stations.value.filter(station => station.name.includes(query.value.trim())))
function changeLine() { lineId.value = null; query.value = '' }
function interchangeLines(stationId: string) {
  return props.dataset.lines.filter(item => item.id !== lineId.value && props.dataset.services.some(service => service.lineId === item.id && service.stops.some(stop => stop.stationId === stationId)))
}
</script>
<template>
  <view class="picker-backdrop" @tap="emit('close')">
    <view class="station-picker" @tap.stop role="dialog" :aria-label="endpoint === 'from' ? '选择起点' : '选择终点'">
      <view class="picker-heading"><text class="picker-title">{{ endpoint === 'from' ? '选择起点' : '选择终点' }}</text><button class="picker-close" aria-label="关闭选站" @tap="emit('close')">×</button></view>
      <template v-if="!line">
        <text class="picker-prompt">先选择线路</text>
        <scroll-view scroll-y class="picker-content">
          <view class="line-grid"><button v-for="item in dataset.lines" :key="item.id" class="line-choice" :aria-label="'选择' + transitDisplayText(item.name)" @tap="lineId = item.id"><view class="line-color" :style="{ backgroundColor: item.color }"/><text class="line-name">{{ transitDisplayText(item.name).replace('演示', '') }}</text><text class="line-chevron">›</text></button></view>
        </scroll-view>
      </template>
      <template v-else>
        <view class="selected-line"><text class="selected-line-name" :style="{ backgroundColor: line.color, color: lineInk(line.color) }">{{ transitDisplayText(line.name).replace('演示', '') }}</text><button class="change-line" aria-label="切换线路" @tap="changeLine">切换线路 ›</button></view>
        <input v-model="query" class="picker-search" placeholder="搜索这条线路的车站" aria-label="搜索所选线路车站"/>
        <text class="picker-prompt">{{ query.trim() ? filtered.length + ' 个匹配车站' : stations.length + ' 站 · 按线路顺序排列' }}</text>
        <scroll-view :key="line.id" scroll-y class="picker-content">
          <view class="station-grid"><button v-for="station in filtered" :key="station.id" :class="['station-option', { selected: selectedId === station.id }]" :aria-label="'选择车站' + station.name" @tap="emit('choose', station.id)"><view class="station-option-heading"><text class="station-option-name">{{ station.name }}</text><text v-if="selectedId === station.id" class="station-check">✓</text></view><view v-if="interchangeLines(station.id).length" class="interchange-label"><text>换乘</text><text v-for="other in interchangeLines(station.id)" :key="other.id" :style="{ borderLeftColor: other.color }" class="interchange-line">{{ transitDisplayText(other.name).replace('演示', '') }}</text></view></button></view>
          <text v-if="!filtered.length" class="picker-empty">这条线路没有匹配车站，请修改名称或切换线路。</text>
        </scroll-view>
      </template>
      <text class="picker-footnote">{{ demo ? '独立合成线网 · 仅供演示' : '仅列运营站点 · 出站换乘车站分别列出' }}</text>
    </view>
  </view>
</template>
<style scoped>
.picker-backdrop { position: fixed; inset: 0; z-index: 100; background: #142b2466; display: flex; align-items: flex-end; justify-content: center; }
.station-picker { width: 100%; max-width: 540px; background: #fff; border-radius: 20px 20px 0 0; padding: 12px 20px calc(16px + env(safe-area-inset-bottom)); max-height: 90vh; box-sizing: border-box; }
.picker-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.picker-title { font-size: 22px; font-weight: 700; color: #273b31; }
button { margin: 0; font-family: inherit; line-height: 1.5; border-radius: 0; background: transparent; }button::after { border: none; }
.picker-close { width: 48px; height: 48px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 30px; color: #596d61; }
.picker-prompt { display: block; margin: 10px 0 12px; font-size: 14px; line-height: 1.6; color: #5d7065; }
.picker-content { height: 48vh; width: 100%; }
.line-grid,.station-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 14px; }
.line-choice { position: relative; display: flex; align-items: center; gap: 9px; text-align: left; padding: 16px 0; min-height: 76px; border-bottom: 1px solid #edf0ed; color: #2e4438; }
.line-color { width: 5px; height: 28px; border-radius: 3px; flex-shrink: 0; }
.line-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 18px; font-weight: 650; }.line-chevron { font-size: 22px; color: #718177; }
.selected-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 8px 0; }.selected-line-name { font-size: 16px; font-weight: 650; line-height: 1.6; padding: 3px 8px; border-radius: 4px; overflow-wrap: anywhere; }
.change-line { flex-shrink: 0; min-height: 44px; padding: 8px 0 8px 8px; display: flex; align-items: center; font-size: 14px; color: #176b52; }
.picker-search { box-sizing: border-box; width: 100%; height: 48px; padding: 10px 12px; border-radius: 8px; background: #f3f5f4; font-size: 16px; color: #273b31; }
.station-option { display: flex; flex-direction: column; justify-content: center; text-align: left; min-height: 72px; padding: 12px 2px; border-bottom: 1px solid #edf0ed; }
.station-option-heading { display: flex; align-items: baseline; gap: 5px; width: 100%; }.station-option-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 17px; font-weight: 600; color: #273b31; }.station-check { flex-shrink: 0; font-size: 16px; color: #176b52; }
.selected .station-option-name { color: #176b52; }.interchange-label { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 5px; margin-top: 5px; font-size: 12px; line-height: 1.6; color: #607367; }.interchange-line { padding-left: 4px; border-left: 3px solid; overflow-wrap: anywhere; }
.picker-footnote { display: block; color: #6b7c70; font-size: 12px; line-height: 1.65; margin-top: 12px; }.picker-empty { display: block; padding: 18px 0; font-size: 15px; line-height: 1.8; color: #5d7065; }
@media (max-width: 359px) { .station-picker { padding-left: 16px; padding-right: 16px; }.line-grid,.station-grid { column-gap: 12px; }.line-name { font-size: 17px; }.station-option-name { font-size: 16px; } }
</style>
