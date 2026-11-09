<script setup lang="ts">
import type { RouteMode } from '../core/types'
import RouteModeIcon from './RouteModeIcon.vue'
defineProps<{ modelValue: RouteMode; appearance?: 'tiles' }>()
const emit = defineEmits<{ 'update:modelValue': [value: RouteMode] }>()
const modes: {id:RouteMode;label:string;symbol:string}[] = [{id:'shortest',label:'最短路线',symbol:'↗'},{id:'few-stairs',label:'不走楼梯',symbol:'≋'},{id:'elevator',label:'无障碍',symbol:'↕'}]
</script>
<template><view :class="['mode-selector',{tiles:appearance==='tiles'}]"><button v-for="item in modes" :key="item.id" :class="['mode-item',{active:modelValue===item.id}]" :aria-label="item.label" :aria-pressed="modelValue===item.id" @tap="emit('update:modelValue',item.id)"><RouteModeIcon :mode="item.id" :large="appearance==='tiles'"/>{{item.label}}</button></view></template>
<style scoped>
.mode-selector { display:flex; width:100%; border-bottom:1px solid #e6ece8; }.mode-item { display:flex; justify-content:center; align-items:center; gap:6px; flex:1; min-width:0; min-height:50px; border-radius:0; border-bottom:3px solid transparent; margin:0; padding:8px 1px; background:transparent; color:#6a786f; font-size:14px; line-height:1.5; }.mode-item::after{border:none}.mode-item.active { color:var(--rx-brand, #176b52); border-bottom-color:var(--rx-brand, #176b52); font-weight:650; }.mode-symbol{font-size:19px}
</style>
<style scoped>
.tiles{gap:9px;border:none}.tiles .mode-item{flex-direction:column;gap:8px;min-height:86px;border:1px solid #e5ebe7;border-radius:12px;font-size:14px;padding:12px 2px;background:#fff;color:#697c6f}.tiles .mode-item.active{border-color:#6b9b7f;background:#f1f7f3;color:#176b52}.tiles .mode-symbol{font-size:27px;line-height:1.1}
</style>
