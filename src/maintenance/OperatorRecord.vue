<script setup lang="ts">
import { computed } from 'vue'
const props=defineProps<{actor:string;note:string}>()
const emit=defineEmits<{'update:actor':[value:string];'update:note':[value:string]}>()
const actorValue=computed({get:()=>props.actor,set:(value:string)=>emit('update:actor',value)})
const noteValue=computed({get:()=>props.note,set:(value:string)=>emit('update:note',value)})
</script>
<template><view class="operator-record"><text class="record-title">操作记录</text><text class="record-hint">核对内容后填写，保存时一并留档。</text><text class="record-label">操作人</text><input v-model="actorValue" placeholder="你的姓名或维护者称呼" maxlength="100" /><text class="record-label">操作说明</text><textarea v-model="noteValue" placeholder="本次核实依据或修改原因（必填）" maxlength="1000" /></view></template>
<style scoped>
.operator-record{border-top:1px solid #e2e9e5;margin-top:16px;padding-top:14px}.record-title,.record-hint,.record-label{display:block}.record-title{font-size:16px;font-weight:650}.record-hint{font-size:13px;line-height:1.7;color:#546b60;margin:6px 0 12px}.record-label{font-size:14px;margin:10px 0 6px}input,textarea{box-sizing:border-box;width:100%;padding:12px;border:1px solid #d7e3dc;border-radius:8px;background:#f4f8f5;font-size:15px}input{height:46px}textarea{height:90px}
</style>
