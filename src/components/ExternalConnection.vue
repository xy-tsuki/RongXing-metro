<script setup lang="ts">
import { transitDisplayText } from '../navigation/line-display'
import type { MetroDataset, RouteMode, TransferGuide } from '../core/types'
import TransferTime from './TransferTime.vue'
defineProps<{ guide: TransferGuide; dataset?: MetroDataset; mode?: RouteMode }>()
</script>
<template>
  <view class="external-connection"><text class="external-title">出站步行衔接 · {{ guide.stationName }}</text><TransferTime :guide="guide" :path="guide.path" :dataset="dataset" :mode="mode"/><text v-for="(step, i) in guide.instructions" :key="i" class="external-step">{{ transitDisplayText(step) }}</text><text class="external-note">具体出入口、步行距离及连续无障碍通路待核实。</text></view>
</template>
<style scoped>
.external-connection { margin: 16px; padding: 15px; background: #f6f2e7; border: 1px solid #d9cba8; border-radius: 10px; color: #66512a; overflow-wrap: anywhere; }
.external-title { display: block; font-size: 17px; font-weight: 700; line-height: 1.6; }
.external-step { display: block; font-size: 15px; line-height: 1.75; margin-top: 10px; }
.external-note { display: block; font-size: 13px; line-height: 1.7; margin-top: 10px; }
</style>
