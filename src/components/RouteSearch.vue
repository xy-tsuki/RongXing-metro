<script setup lang="ts">
import type { RouteMode } from '../core/types'
import type { DepartureIntent } from '../navigation/timing'
import ModeSelector from './ModeSelector.vue'
import DeparturePicker from './DeparturePicker.vue'
defineProps<{ from: string; to: string; mode: RouteMode; busy: boolean; departure: DepartureIntent }>()
const emit = defineEmits<{ pick: [value: 'from' | 'to']; swap: []; mode: [value: RouteMode]; search: []; departure: [value: DepartureIntent] }>()
</script>
<template>
  <view class="search-screen">
    <text class="search-eyebrow">福州地铁精细化导航</text><text class="search-title">这一程，去哪里？</text><text class="search-intro">选好车站，把换乘走得更顺一点。</text>
    <view class="station-panel">
      <view class="station-connector"/>
      <button class="station-main" aria-label="选择起点" @tap="emit('pick','from')"><view class="station-mark"/><view class="station-copy"><text class="endpoint-label">出发站</text><text class="endpoint-name">{{ from }}</text></view><text class="endpoint-chevron">›</text></button>
      <button class="station-main" aria-label="选择终点" @tap="emit('pick','to')"><view class="station-mark end-mark"/><view class="station-copy"><text class="endpoint-label">到达站</text><text class="endpoint-name">{{ to }}</text></view><text class="endpoint-chevron">›</text></button>
      <button class="exchange" aria-label="交换起终点" @tap="emit('swap')"><text class="exchange-icon" aria-hidden="true">⇅</text></button>
    </view>
    <DeparturePicker :model-value="departure" @update:model-value="emit('departure',$event)"/>
    <view class="preference-heading"><text>路线偏好</text><text class="preference-note">换一种走法</text></view>
    <ModeSelector appearance="tiles" :model-value="mode" @update:model-value="emit('mode',$event)"/>
    <text class="mode-help">{{ mode==='few-stairs'?'优先扶梯与电梯；仍可能含楼梯，以方案为准。':mode==='elevator'?'只提供已核实的连续无障碍通路。':'优先缩短站内步行，让换乘更顺路。' }}</text>
    <button class="search-go" aria-label="查询路线" :loading="busy" @tap="emit('search')"><text>查询路线</text><text>→</text></button>
    <text class="search-footnote">线路换乘 · 车厢车门 · 逐段指引</text>
  </view>
</template>
<style scoped>
.search-screen{padding:22px 6px 12px}.search-eyebrow{display:block;font-size:12px;letter-spacing:1px;color:#7b8a80;margin-bottom:7px}.search-title{display:block;font-size:28px;font-weight:750;line-height:1.4;letter-spacing:-.5px;color:#253c30}.search-intro{display:block;font-size:14px;color:#728477;margin-top:8px;line-height:1.7}.station-panel{margin:26px 0 16px;position:relative;border:1px solid #e4ebe6;border-radius:16px;padding:3px 58px 3px 16px}.station-main{width:100%;text-align:left;padding:15px 0;margin:0;background:transparent;border-radius:0;display:flex;align-items:center;gap:14px;min-height:88px;line-height:1.4;overflow:visible}.station-main+.station-main{border-top:1px solid #edf1ee}.station-mark{box-sizing:border-box;width:13px;height:13px;border:3px solid #438565;background:#fff;border-radius:50%;flex-shrink:0;z-index:1}.end-mark{background:#438565}.station-connector{position:absolute;left:21px;top:48px;bottom:48px;border-left:2px dotted #c3d5c8}.station-copy{flex:1;min-width:0}.endpoint-label{display:block;font-size:12px;color:#7c8e81;line-height:1.6;margin-bottom:3px}.endpoint-name{display:block;font-size:27px;font-weight:700;line-height:1.35;color:#2d4e3a;overflow-wrap:anywhere}.endpoint-chevron{font-size:22px;color:#a6b2aa;flex-shrink:0}.exchange{position:absolute;right:10px;top:50%;transform:translateY(-50%);width:44px;height:44px;margin:0;background:#f0f4f1;border-radius:50%;color:#5b7b65;font-size:25px;line-height:44px}.station-main::after,.exchange::after,.search-go::after{border:none}.preference-heading{margin:24px 0 11px;display:flex;align-items:baseline;justify-content:space-between;font-size:14px;font-weight:650;color:#475e4e}.preference-note{font-weight:400;font-size:12px;color:#839187}.mode-help{display:block;min-height:22px;font-size:12px;line-height:1.7;color:#718175;margin:10px 0 0}.search-go{width:100%;min-height:54px;background:#176b52;color:#fff;margin:22px 0 0;border-radius:13px;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;font-size:18px;font-weight:650;line-height:1.5}.search-footnote{display:block;text-align:center;color:#8a978e;font-size:12px;margin:13px 0 0;line-height:1.6}@media(max-width:359px){.search-screen{padding:16px 4px 10px}.search-title{font-size:26px}.endpoint-name{font-size:24px}.station-panel{margin-top:22px;padding-right:53px;padding-left:12px}.station-main{gap:11px}.station-connector{left:17px}.search-go{margin-top:18px}}
</style>
<style scoped>
.exchange { display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1; }
.exchange-icon { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; font-size: inherit; line-height: 1; }
</style>
