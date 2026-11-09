<script setup lang="ts">
import { computed, ref } from 'vue'
import { clockWheelItems, clockWheelState, clockWheelText, moveClockWheel } from '../navigation/clock-wheel'
const props = defineProps<{ value: string }>()
const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>()
const state = ref(clockWheelState(props.value))
const hours = clockWheelItems(24), minutes = clockWheelItems(60)
const label = computed(() => clockWheelText(state.value))
function change(event: { detail: { value: number[] } }) { state.value = moveClockWheel(state.value, event.detail.value) }
</script>
<template>
  <view class="clock-backdrop" @tap="emit('cancel')">
    <view class="clock-sheet" @tap.stop>
      <view class="clock-actions"><button aria-label="取消选择时刻" @tap="emit('cancel')">取消</button><text class="clock-title">选择出发时刻</text><button class="clock-done" aria-label="确定选择时刻" @tap="emit('confirm',label)">确定</button></view>
      <text class="clock-preview" aria-live="polite">{{ label }}</text>
      <view class="wheel-labels"><text>时</text><text>分</text></view>
      <picker-view class="clock-wheel" :value="state.indices" indicator-style="height:44px;" @change="change">
        <picker-view-column><view v-for="(hour,i) in hours" :key="i" class="wheel-number">{{hour}}</view></picker-view-column>
        <picker-view-column><view v-for="(minute,i) in minutes" :key="i" class="wheel-number">{{minute}}</view></picker-view-column>
      </picker-view>
      <text class="clock-hint">分钟循环时联动小时，所选日期保持不变</text>
    </view>
  </view>
</template>
<style scoped>
.clock-backdrop{position:fixed;inset:0;z-index:170;background:#172f284d;display:flex;align-items:flex-end;justify-content:center}.clock-sheet{width:100%;max-width:540px;box-sizing:border-box;padding:8px 18px calc(22px + env(safe-area-inset-bottom));border-radius:22px 22px 0 0;background:#fff;color:#2e4d3d}.clock-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.clock-actions button{display:flex;align-items:center;justify-content:center;min-width:58px;min-height:48px;padding:10px 6px;margin:0;background:transparent;color:#65776b;font-size:16px;line-height:1.5}.clock-actions button::after{border:none}.clock-actions .clock-done{font-weight:700;color:#176b52}.clock-title{font-size:18px;font-weight:650}.clock-preview{display:block;text-align:center;font-size:30px;font-weight:700;line-height:1.6;font-variant-numeric:tabular-nums;margin:7px 0}.wheel-labels{display:flex;text-align:center;font-size:14px;color:#65776b}.wheel-labels text{flex:1}.clock-wheel{width:100%;height:220px;margin-top:2px}.wheel-number{display:flex;align-items:center;justify-content:center;height:44px;font-size:25px;line-height:44px;font-variant-numeric:tabular-nums}.clock-hint{display:block;text-align:center;font-size:13px;line-height:1.7;color:#65776b;margin-top:10px}
</style>
