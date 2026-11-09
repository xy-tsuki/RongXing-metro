<script setup lang="ts">
import { serviceClassLabels, type ServiceClass } from '../navigation/service-class'
defineProps<{ value?: ServiceClass }>()
</script>
<template>
  <text v-if="value" :class="['service-class', value]" :aria-label="'列车类型：' + serviceClassLabels[value]">{{ serviceClassLabels[value] }}</text>
</template>
<style scoped>
.service-class { display: inline-block; flex-shrink: 0; white-space: nowrap; border-radius: 5px; padding: 2px 7px; font-size: 13px; font-weight: 650; line-height: 1.65; vertical-align: middle; }
.local { background: #edf0f1; color: #52616a; }
.limited-express { background: #fff0de; color: #a64c00; }
.direct-express { background: #ffebeb; color: #b52932; }
</style>
