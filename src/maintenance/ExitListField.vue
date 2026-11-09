<script setup lang="ts">
import { computed, ref } from 'vue'
import { appendExit, exitEntries } from './collection-fields'
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const entries = computed(() => exitEntries(props.modelValue))
const adding = ref(false), name = ref(''), error = ref('')
function add() {
  try {
    emit('update:modelValue', appendExit(props.modelValue, name.value))
    name.value = ''; error.value = ''; adding.value = false
  } catch(e) { error.value = (e as Error).message }
}
function remove(index: number) {
  emit('update:modelValue', entries.value.filter((_, i) => i !== index).join('、'))
}
</script>
<template>
  <view class="exit-field">
    <view class="exit-list">
      <text v-if="!entries.length" class="empty">无</text>
      <view v-for="(entry,index) in entries" :key="entry" class="exit-item"><text>{{entry}}</text><button :aria-label="'移除出入口'+entry" @tap="remove(index)">×</button></view>
      <button class="add-exit" aria-label="添加最近出入口" @tap="adding=true">＋ 添加</button>
    </view>
    <view v-if="adding" class="exit-entry">
      <text class="entry-label">出入口名称</text><input v-model="name" aria-label="出入口名称" placeholder="例如：A口" maxlength="100" @confirm="add" />
      <text v-if="error" class="field-error" role="alert">{{error}}</text>
      <view class="entry-actions"><button @tap="adding=false; name=''; error=''">取消</button><button class="confirm" @tap="add">添加出入口</button></view>
    </view>
  </view>
</template>
<style scoped>
.exit-list{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.empty{font-size:15px;color:#758379}.exit-item{display:flex;align-items:center;max-width:100%;background:#f1f5f2;border-radius:8px;padding-left:12px;color:#2d4e3a;font-size:16px;font-weight:600}.exit-item>text{overflow-wrap:anywhere;min-width:0}.exit-item button{margin:0;width:44px;min-width:44px;height:44px;line-height:44px;padding:0;background:transparent;font-size:21px;color:#6b7e70}.add-exit,.entry-actions button{margin:0;min-height:44px;padding:8px 14px;font-size:15px;line-height:28px;background:#f2f5f3;color:#176b52}.exit-item button::after,.add-exit::after,.entry-actions button::after{border:0}.exit-entry{margin-top:12px;background:#f7f9f7;border-radius:10px;padding:12px}.entry-label{display:block;font-size:14px;color:#4c6052;margin-bottom:8px}.exit-entry input{box-sizing:border-box;width:100%;min-height:44px;padding:10px;background:#fff;border:1px solid #dce5de;border-radius:7px;font-size:16px}.entry-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.entry-actions .confirm{background:#176b52;color:#fff}.field-error{display:block;color:#a73535;font-size:14px;margin-top:10px}
</style>
