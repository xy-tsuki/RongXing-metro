<script setup lang="ts">
import { ref } from 'vue'
import type { FarePresentation } from '../navigation/fare-presentation'
import { fareDisplaySources } from '../navigation/fare-presentation'
defineProps<{ value: FarePresentation | null; compact?: boolean; stationNames?: Record<string, string>; explanationOnly?: boolean; open?: boolean }>()
const expanded = ref(false)
function sources() {
  uni.showModal({ title: '票价数据来源', content: '票制：福州市发改委（2025年通知）；里程：福州地铁车站列表。数据日期：'+fareDisplaySources.generatedAt+'。按进出站最短路径计价，出站换乘分段相加，同站进出2元；显示成人基础票价，不含优惠。', showCancel: false })
}
</script>
<template>
  <view v-if="value && compact" class="column-fare">
    <text class="column-amount" :aria-label="'票价'+value.quote.amount+'元'">{{value.quote.amount}} 元</text>
  </view>
  <view v-else-if="value" :class="['journey-fare', {'explanation-only': explanationOnly}]">
    <button v-if="!explanationOnly" class="fare-heading" aria-label="查看票价说明" :aria-expanded="expanded" @tap="expanded=!expanded">
      <view><text class="fare-caption">{{value.segments.length===1 && value.segments[0].fromStationId===value.segments[0].toStationId ? '同站进出票价' : value.segments.length>1 ? '票价 · 分段计费' : '票价'}}</text><text class="fare-amount">{{value.quote.amount}} 元</text></view>
      <text class="fare-link">计费说明 {{expanded?'⌃':'⌄'}}</text>
    </button>
    <view v-if="explanationOnly ? open : expanded" class="fare-explanation">
        <text>成人基础票价，不含优惠。每次进站—出站按最短路径计价，与闸内换乘路线无关。</text>
        <template v-if="value.segments.length>1"><text>出站换乘需要重新进站，以下各段票价相加。</text><view v-for="(segment,index) in value.segments" :key="index" class="fare-segment"><text>{{stationNames?.[segment.fromStationId] ?? '进站'}} → {{stationNames?.[segment.toStationId] ?? '出站'}}</text><text>{{segment.fareYuan}} 元</text></view></template>
        <view v-if="value.segments.length===1 && value.quote.newDistrict>0" class="fare-breakdown"><text v-if="value.quote.mainArea>0">主城区段 {{value.quote.mainArea}} 元</text><text>滨海快线新区段 {{value.quote.newDistrict}} 元</text></view>
      <button class="fare-source" @tap="sources">数据来源与计费规则 ›</button>
    </view>
  </view>
</template>
<style scoped>
.column-fare{margin-top:6px;min-height:22px;font-size:15px;line-height:22px;color:#3e5f4c;font-variant-numeric:tabular-nums}.column-amount{font-weight:650;white-space:nowrap}.separate-caption{font-size:11px;line-height:1.5;color:#7a857d}.journey-fare{margin:10px 0 12px;border-top:1px solid #e9eeeb;border-bottom:1px solid #e9eeeb}.fare-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:62px;width:100%;margin:0;padding:10px 0;background:transparent;border-radius:0;text-align:left;line-height:1.5;color:#304f3b}.fare-heading::after,.fare-source::after{border:0}.fare-caption{display:block;font-size:12px;color:#728377;font-weight:400}.fare-amount{display:block;font-size:20px;line-height:1.5;font-weight:650}.fare-link{font-size:13px;color:#677f6e;flex-shrink:0}.fare-explanation{font-size:13px;line-height:1.8;color:#627669;padding:0 0 8px}.fare-explanation>text{display:block;margin:5px 0}.fare-breakdown{display:flex;flex-wrap:wrap;gap:4px 16px;color:#3f5c49;margin:7px 0}.fare-source{margin:4px 0 0;padding:8px 0;min-height:44px;background:transparent;color:#176b52;font-size:13px;line-height:28px;text-align:left}
</style>
<style scoped>.explanation-only{margin:0;border:0}.explanation-only .fare-explanation{padding:0 0 12px}.fare-segment{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:7px 0}.fare-segment>text:first-child{min-width:0;overflow-wrap:anywhere}.fare-segment>text:last-child{white-space:nowrap;font-weight:600}</style>
