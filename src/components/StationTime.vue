<script setup lang="ts">
import { computed } from 'vue'
import { arrivalDayLabel, clockText } from '../navigation/timing'
const props = defineProps<{ at?: string; journeyStart?: string; offset?: number }>()
const clock = computed(() => clockText(props.at, props.offset))
const day = computed(() => arrivalDayLabel(props.journeyStart, props.at, props.offset))
</script>
<template><view class="station-time" :aria-label="clock?'节点时间 '+day+' '+clock:'节点时间待接入'"><text>{{ clock??'—' }}</text><text v-if="day" class="station-day">{{ day }}</text></view></template>
<style scoped>
.station-time{position:absolute;left:0;top:13px;width:47px;text-align:right;color:#3b6250;font-size:15px;font-weight:700;line-height:1.7;font-variant-numeric:tabular-nums;white-space:nowrap}.station-day{display:block;color:#7a8c80;font-size:10px;font-weight:400;line-height:1.2}
</style>
