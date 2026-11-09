<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DepartureIntent } from '../navigation/timing'
import { clockText } from '../navigation/timing'
import ClockPicker from './ClockPicker.vue'
const props = defineProps<{ modelValue: DepartureIntent }>()
const emit = defineEmits<{ 'update:modelValue': [value: DepartureIntent] }>()
const open = ref(false), day = ref(''), time = ref('')
const clockOpen = ref(false)
const label = computed(() => props.modelValue.kind === 'now' ? '现在出发' : `${props.modelValue.departureAt?.slice(5, 10).replace('-', '月')}日 ${clockText(props.modelValue.departureAt) ?? '—'} 出发`)
function edit() {
  const stamp = props.modelValue.departureAt ?? new Date().toISOString()
  day.value = new Date(Date.parse(stamp) + 480 * 60_000).toISOString().slice(0, 10)
  time.value = clockText(stamp) ?? '08:00'; clockOpen.value = false; open.value = true
}
function apply() { emit('update:modelValue', { kind: 'scheduled', departureAt: `${day.value}T${time.value}:00+08:00` }); open.value = false }
function now() { emit('update:modelValue', { kind: 'now' }); open.value = false }
</script>
<template>
  <button class="departure-trigger" aria-label="出发时间设置" @tap="edit"><view class="time-label"><text class="clock-icon">◷</text><text>出发时间</text></view><text class="time-selected">{{ label }}</text><text class="time-chevron">›</text></button>
  <view v-if="open" class="departure-backdrop" @tap="open=false"><view class="departure-sheet" @tap.stop>
    <view class="departure-heading"><text>什么时候出发？</text><button aria-label="关闭时间设置" @tap="open=false"><text class="close-icon" aria-hidden="true">×</text></button></view>
    <text class="timezone-note">福州时间 · 查询所选时间起 30 分钟内的班次</text>
    <view class="picker-row"><text class="picker-label">日期</text><picker class="date-time-control" mode="date" :value="day" @change="day=$event.detail.value"><view class="picker-value" aria-label="选择出发日期"><text class="picker-number">{{ day }}</text><text class="picker-chevron" aria-hidden="true">⌄</text></view></picker></view>
    <view class="picker-row"><text class="picker-label">时间</text><button class="date-time-control clock-control" aria-label="选择出发时刻" @tap="clockOpen=true"><view class="picker-value"><text class="picker-number">{{ time }}</text><text class="picker-chevron" aria-hidden="true">⌄</text></view></button></view>
    <text class="timezone-note">1／2／4／5号线：周末／节假日时刻，工作日暂缺。滨海快线：每日，普通车推算。当前仅按周末匹配，节假日日期待补。</text>
    <button class="time-confirm" aria-label="确认出发时间" @tap="apply"><text class="time-button-label">使用这个时间</text></button><button class="time-now" aria-label="现在出发" @tap="now"><text class="time-button-label">现在出发</text></button>
  </view></view>
  <ClockPicker v-if="open&&clockOpen" :value="time" @cancel="clockOpen=false" @confirm="time=$event;clockOpen=false"/>
</template>
<style scoped>
.departure-trigger{display:flex;align-items:center;gap:8px;min-height:58px;width:100%;padding:10px 14px;margin:0;background:#f5f7f6;border-radius:12px;text-align:left;font-size:14px;color:#50665a;line-height:1.6}.departure-trigger::after,.departure-sheet button::after{border:none}.time-label{display:flex;align-items:center;gap:7px;flex-shrink:0}.clock-icon{font-size:21px}.time-selected{margin-left:auto;font-weight:650;color:#2e4d3d;overflow-wrap:anywhere}.time-chevron{color:#83938a;font-size:22px}.departure-backdrop{position:fixed;inset:0;background:#172f284d;z-index:150;display:flex;align-items:flex-end;justify-content:center}.departure-sheet{box-sizing:border-box;background:#fff;width:100%;max-width:540px;padding:18px 22px calc(20px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0}.departure-heading{display:flex;align-items:center;justify-content:space-between;font-size:22px;font-weight:700}.departure-heading button{background:transparent;color:#657c6e;margin:0;padding:0;width:44px;height:44px;font-size:28px;line-height:44px}.timezone-note{display:block;color:#6d7e73;font-size:13px;line-height:1.7;margin:8px 0 15px}.picker-row{min-height:56px;display:flex;align-items:center;justify-content:space-between;font-size:16px;border-bottom:1px solid #edf0ee}.picker-value{min-width:180px;min-height:52px;display:flex;align-items:center;justify-content:flex-end;gap:15px;font-weight:650;color:#315a42}.time-confirm{margin:20px 0 6px;min-height:52px;border-radius:12px;background:#176b52;color:#fff;font-size:17px;line-height:52px}.time-now{min-height:48px;line-height:48px;font-size:15px;color:#486851;background:transparent;margin:0}
</style>
<style scoped>
.departure-heading button { display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 1; }
.close-icon { display: block; font-size: inherit; line-height: 1; }
.picker-label { flex: 0 0 48px; line-height: 1.5; }.date-time-control { flex: 1; min-width: 0; }
.picker-value { width: 100%; min-width: 0; padding: 0; }.picker-number { line-height: 1.5; font-variant-numeric: tabular-nums; }
.picker-chevron { display: flex; align-items: center; justify-content: center; width: 20px; height: 24px; line-height: 1; }
.time-confirm,.time-now { display: flex; align-items: center; justify-content: center; width: 100%; padding: 10px 14px; line-height: 1.5; text-align: center; }
.time-button-label { display: block; font-size: inherit; line-height: 1.5; }
.clock-control { display:block; margin:0; padding:0; border-radius:0; background:transparent; font-size:16px; }
</style>
