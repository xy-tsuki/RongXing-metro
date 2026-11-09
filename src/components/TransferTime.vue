<script setup lang="ts">
import { computed } from 'vue'
import type { MetroDataset, RouteMode, TransferGuide, WalkPath } from '../core/types'
import type { TimingValue } from '../navigation/timing'
import { transferTimePresentation } from './transfer-time'
const props = defineProps<{ guide: TransferGuide; path?: WalkPath | null; value?: TimingValue; dataset?: MetroDataset; mode?: RouteMode }>()
const time = computed(() => transferTimePresentation(props.guide, props.path, props.value, props.dataset, props.mode))
const source = computed(() => ({ demo: '演示估算', estimate: '估算', timetable: '时刻表', realtime: '实时数据' })[time.value.source])
</script>
<template>
  <view class="transfer-time">
    <text class="transfer-minutes">{{ time.label }} {{ time.minutes }} 分钟<text class="transfer-source"> · {{ time.preset ? '默认预设' : source }}</text></text>
    <text v-if="time.preset" class="preset-note">暂无换乘时间数据，默认预设 {{ time.minutes }} 分钟，请以现场情况为准。</text>
    <text v-if="time.waitingMinutes !== null" class="waiting-time">候车 {{ time.waitingMinutes }} 分钟 · {{ source }}</text>
  </view>
</template>
<style scoped>
.transfer-time { margin-top: 3px; font-size: 14px; line-height: 1.7; color: #465f50; }.transfer-minutes,.waiting-time { display: block; }.transfer-minutes { font-weight: 600; }.transfer-source { font-size: 12px; font-weight: 400; color: #637569; }.preset-note { display: block; font-size: 13px; line-height: 1.65; font-weight: 400; color: #69776d; margin-top: 3px; }.waiting-time { font-size: 13px; font-weight: 400; }
</style>
