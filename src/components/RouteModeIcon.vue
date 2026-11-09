<script setup lang="ts">
import type { RouteMode } from '../core/types'
defineProps<{ mode: RouteMode; large?: boolean }>()
const assets: Record<RouteMode, string> = { shortest: 'run', 'few-stairs': 'escalator', elevator: 'elevator' }
</script>
<template><view :class="['mode-icon-frame',{large}]"><image :class="['route-mode-icon',assets[mode]]" :src="'/static/icons/'+assets[mode]+'.png'" mode="aspectFit" aria-hidden="true"/></view></template>
<style scoped>
/* Optical sizes account for the supplied PNGs' different content bounds and visual weight.
   Running: 200x146 visible; lift: 168x184; escalator fills 200x200 and is deliberately smaller. */
.mode-icon-frame{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:26px}.route-mode-icon{display:block;flex-shrink:0}.run{width:30px;height:30px}.elevator{width:25px;height:25px}.escalator{width:22px;height:22px}.large{width:44px;height:36px}.large .run{width:40px;height:40px}.large .elevator{width:34px;height:34px}.large .escalator{width:30px;height:30px}
</style>
