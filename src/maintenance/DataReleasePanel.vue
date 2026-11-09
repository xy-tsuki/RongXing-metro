<script setup lang="ts">
import { ref, watch } from 'vue'
import { maintenanceRequest as api } from './api'
import type { DataManifest } from '../data/release-contract'
const props = defineProps<{ actor:string; note:string; active?:boolean }>()
const state = ref<{ current:DataManifest|null; imports:{id:string; version:string; createdAt:string}[]; history:(DataManifest & {actor:string;note:string})[] } | null>(null)
const selection = ref<{ importId?:string; releaseId?:string }>({})
const showHistory = ref(false)
const index = ref(0), busy = ref(false), error = ref(''), message = ref(''), confirmed = ref(false)
const preview = ref<{token:string;version:string;timetableVersion:string;previousTimetableVersion:string|null;revision:number;trips:number;previousTrips:number;stops:number;stations:number;calendarYears:number[];notice:string;rollback:boolean;difference:{addedTrips:number;changedTrips:number;removedTrips:number;networkChanged:boolean;calendarChanged:boolean}}|null>(null)
async function action(fn:()=>Promise<void>) { if(busy.value)return; busy.value=true;error.value='';message.value='';try{await fn()}catch(e){error.value=(e as Error).message}finally{busy.value=false} }
async function load() { state.value=await api('/api/admin/data'); index.value=0; selection.value={importId:state.value!.imports[0]?.id};preview.value=null }
watch(()=>props.active,value=>{if(value && !state.value) void action(load)},{immediate:true})
watch(selection,()=>{preview.value=null;confirmed.value=false})
function choose(e:any) { index.value=Number(e.detail.value); selection.value={importId:state.value?.imports[index.value]?.id} }
async function publish() { await action(async()=>{
  if(!preview.value||!confirmed.value)throw new Error('请先预览并勾选确认')
  await api('/api/admin/data/publish','POST',{...selection.value,token:preview.value.token,confirm:preview.value.version,actor:props.actor,note:props.note})
  await load();message.value='发布完成，联网访客将自动检查并更新；无需重建前端。'
}) }
</script>
<template>
  <view class="card">
    <text class="heading">导航数据发布</text>
    <text class="hint">导入和审核后，预览并确认上线。整套发布已审核线网、选定时刻表和日历，未审核投稿不发布。使用审核人和说明，自动备份并保留发布记录。</text>
    <button :disabled="busy" @tap="action(load)">刷新发布状态</button>
    <template v-if="state">
      <text class="hint">当前线上：{{state.current?.timetableVersion || '尚未发布'}} · {{state.current?.publishedAt || ''}}</text>
      <picker v-if="state.imports.length" :range="state.imports.map(i=>i.version+' · '+i.createdAt)" :value="index" @change="choose"><view class="select">{{state.imports[index]?.version}} ▾</view></picker>
      <text v-if="selection.releaseId" class="hint">正在预览历史版本回退：{{selection.releaseId}}</text>
      <button :disabled="busy || (!selection.importId && !selection.releaseId)" @tap="action(async()=>{preview=await api('/api/admin/data/preview','POST',selection);confirmed=false})">预览发布差异</button>
      <view v-if="preview" class="hint">
        <text>{{preview.rollback?'回退发布':'更新发布'}}：{{preview.previousTimetableVersion || '无线上版本'}} → {{preview.timetableVersion}}</text>
        <text>班次 {{preview.previousTrips}} → {{preview.trips}} · {{preview.stops}} 条停站 · {{preview.stations}} 站</text>
        <text>已审核资料 revision {{preview.revision}} · 日历 {{preview.calendarYears.join('、')}}</text>
        <text>班次新增 {{preview.difference.addedTrips}} / 修改 {{preview.difference.changedTrips}} / 移出当前版 {{preview.difference.removedTrips}}（历史保留）</text>
        <text>线网变化：{{preview.difference.networkChanged?'有':'无'}} · 日历变化：{{preview.difference.calendarChanged?'有':'无'}}</text><text>{{preview.notice}}</text>
        <slot name="audit" />
        <button @tap="confirmed=!confirmed">{{confirmed?'☑':'☐'}} 已核对，确认整套数据上线</button>
        <button class="primary" :disabled="busy || !confirmed || !actor.trim() || !note.trim()" @tap="publish">确认发布到导航</button>
      </view>
      <button v-if="state.history.length" @tap="showHistory=!showHistory">历史发布 · {{state.history.length}} 条 {{showHistory?'收起':'展开'}}</button>
      <template v-if="showHistory"><view v-for="item in state.history" :key="item.publishedAt+item.version" class="history">
        <text>{{item.timetableVersion}} · {{item.publishedAt}} · {{item.actor}}</text><text>{{item.note}}</text>
        <button :disabled="busy" @tap="selection={releaseId:item.version}">选择此版并预览回退</button>
      </view></template>
    </template>
    <text v-if="error" class="error">{{error}}</text><text v-if="message" class="message">{{message}}</text>
  </view>
</template>
<style scoped>
.card{border:1px solid #d7e3dc;border-radius:14px;padding:16px;margin-top:14px;overflow-wrap:anywhere}.heading{font-size:18px;font-weight:700}.hint,.history{font-size:13px;line-height:1.8;margin-top:12px}.hint text,.history text{display:block}.history{border-top:1px solid #d7e3dc;padding-top:10px}.select{padding:12px;background:#f4f8f5;border-radius:8px}button{margin-top:10px;padding:12px;font-size:14px;line-height:1.5}.primary{background:#17664c;color:white}.error{color:#8c2631}.message{color:#17664c}
</style>
