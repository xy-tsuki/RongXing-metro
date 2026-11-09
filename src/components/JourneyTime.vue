<script setup lang="ts">
import { computed } from 'vue'
import type { TimingValue } from '../navigation/timing'
import { arrivalDayLabel, clockText, validMinutes } from '../navigation/timing'
import { scheduleLabel } from '../navigation/schedule-presentation'
const props = defineProps<{ value?: TimingValue; kind?: 'route' | 'ride' | 'transfer'; placeholder?: boolean; durationOnly?: boolean }>()
const departure = computed(() => clockText(props.value?.departureAt, props.value?.utcOffsetMinutes))
const arrival = computed(() => clockText(props.value?.arrivalAt, props.value?.utcOffsetMinutes))
const arrivalDay = computed(() => arrivalDayLabel(props.value?.departureAt,props.value?.arrivalAt,props.value?.utcOffsetMinutes))
const duration = computed(() => validMinutes(props.value?.durationMinutes))
const walk = computed(() => validMinutes(props.value?.walkingMinutes))
const wait = computed(() => validMinutes(props.value?.waitingMinutes))
const source = computed(() => scheduleLabel(props.value?.schedule) || ({demo:'演示估算',estimate:'估算',timetable:'时刻表',realtime:'实时数据'})[props.value?.source ?? 'estimate'])
const visible = computed(() => props.placeholder || departure.value || arrival.value || duration.value !== null || walk.value !== null || wait.value !== null)
</script>
<template>
  <view v-if="visible" :class="['journey-time', { compact: kind !== 'route' }]">
    <template v-if="kind === 'route'">
      <view class="clock-range"><view><text class="clock-caption">出发</text><text class="clock-value">{{ departure ?? '—' }}</text></view><text class="time-arrow">→</text><view><text class="clock-caption">到达{{arrivalDay?' · '+arrivalDay:''}}</text><text class="clock-value">{{ arrival ?? '—' }}</text></view><view class="duration"><text class="clock-caption">{{ duration === null ? '总耗时' : source }}</text><text class="duration-value">{{ duration === null ? '—' : duration + ' 分' }}</text></view></view>
      <text v-if="!departure && !arrival" class="pending-time">具体时刻待接入</text>
    </template>
    <template v-else-if="kind === 'transfer'"><text v-if="walk !== null">步行约 {{ walk }} 分钟</text><text v-if="wait !== null">候车 {{ wait }} 分钟 · {{ source }}</text></template>
    <template v-else><text v-if="departure&&!durationOnly">上车 {{ departure }}</text><text v-if="arrival&&!durationOnly">下车 {{arrivalDay}} {{ arrival }}</text><text v-if="duration !== null">{{ source }} {{ duration }} 分钟</text></template>
  </view>
</template>
<style scoped>
.journey-time { color: #56675f; }.clock-range { display: flex; align-items: center; gap: 15px; }.clock-caption { display: block; font-size: 12px; line-height: 1.6; color: #79867e; }.clock-value { font-size: 26px; font-weight: 650; line-height: 1.35; color: #273d33; }.time-arrow { color: #9da9a2; }.duration { margin-left: auto; }.duration-value { font-size: 19px; font-weight: 650; line-height: 1.6; color: #38624c; }.pending-time { display: block; font-size: 12px; color: #7c887f; margin-top: 4px; }.compact { display: flex; flex-wrap: wrap; gap: 5px 14px; font-size: 13px; line-height: 1.7; margin-top: 6px; }
</style>
