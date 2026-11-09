<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { appendDoor, doorEntries } from './facility-form'
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const adding = ref(false), car = ref(''), door = ref(''), error = ref('')
const entries = computed(() => {
  try { return doorEntries(props.modelValue) } catch { return [] }
})
watch(() => props.modelValue, () => { adding.value = false; car.value = ''; door.value = ''; error.value = '' })
function add() {
  try {
    emit('update:modelValue', appendDoor(props.modelValue, car.value, door.value))
    adding.value = false; car.value = ''; door.value = ''; error.value = ''
  } catch (e) { error.value = (e as Error).message }
}
</script>
<template>
  <view class="door-field">
    <view class="door-list">
      <text v-if="!entries.length" class="empty">无</text>
      <text v-for="entry in entries" :key="`${entry.car}:${entry.door}`" class="door-position">{{ entry.car }} 车 {{ entry.door }} 门</text>
      <button class="add-position" aria-label="添加车厢车门" @tap="adding = true">＋ 添加</button>
    </view>
    <view v-if="adding" class="door-entry">
      <view class="number-fields">
        <view><text>车厢号</text><input v-model="car" type="number" inputmode="numeric" aria-label="车厢号" placeholder="填写车厢号" maxlength="8" /></view>
        <view><text>车门号</text><input v-model="door" type="number" inputmode="numeric" aria-label="车门号" placeholder="填写车门号" maxlength="8" /></view>
      </view>
      <text v-if="error" class="field-error" role="alert">{{ error }}</text>
      <view class="entry-actions"><button @tap="adding = false; error = ''">取消</button><button class="confirm" @tap="add">添加门位</button></view>
    </view>
  </view>
</template>
<style scoped>
.door-list{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.empty{color:#758379;font-size:15px}.door-position{font-size:16px;font-weight:600;color:#2d4e3a;padding:9px 12px;background:#f1f5f2;border-radius:8px}.add-position,.entry-actions button{margin:0;min-height:44px;padding:8px 14px;font-size:15px;line-height:28px;background:#f2f5f3;color:#176b52}.add-position::after,.entry-actions button::after{border:0}.door-entry{margin-top:12px;background:#f7f9f7;border-radius:10px;padding:12px}.number-fields{display:flex;gap:12px}.number-fields>view{flex:1;min-width:0}.number-fields text{display:block;font-size:14px;color:#4c6052;margin-bottom:8px}.number-fields input{box-sizing:border-box;width:100%;min-height:44px;padding:10px;background:#fff;border:1px solid #dce5de;border-radius:7px;font-size:16px}.entry-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.entry-actions .confirm{background:#176b52;color:#fff}.field-error{display:block;color:#a73535;font-size:14px;margin-top:10px}
</style>
