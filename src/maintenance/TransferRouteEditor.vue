<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DoorPositionField from './DoorPositionField.vue'
import { transferWalkingText, verticalMoves, type TransferRouteDraft, type TransferWalkingTarget } from './transfer-entry'
const props = defineProps<{ route: TransferRouteDraft; target?: TransferWalkingTarget }>()
const draft = computed(() => props.route)
const step = ref(0), showPreview = ref(false)
const steps = ['下车后', '换乘通道', '进入站台']
const facilities = ['暂不填写', '楼梯', '扶梯', '电梯']
const pick = (e: any) => Number(e.detail.value)
watch(() => props.route, () => { step.value = 0; showPreview.value = false })
const preview = computed(() => { try { return transferWalkingText(props.route, props.target) } catch(e) { return (e as Error).message } })
</script>
<template>
  <view class="transfer-editor">
    <view class="walk-steps"><button v-for="(label,index) in steps" :key="label" :class="{active:step===index}" :aria-label="'填写第'+(index+1)+'步'+label" :aria-pressed="step===index" @tap="step=index"><text class="step-number">{{index+1}}</text><text>{{label}}</text></button></view>
    <template v-if="draft.walk">
      <view v-show="step===0" class="step-content">
        <text class="step-title">下车后，从哪里开始换乘？</text>
        <text class="help">站在下车的位置记录。只知道门位、设施中的一项也可以。</text>
        <text class="field-title">在哪个车门下车？<text class="optional">选填</text></text>
        <DoorPositionField v-model="draft.fromDoors" />
        <text class="field-title">先走哪种设施？<text class="optional">选填</text></text>
        <picker :range="facilities" :value="Math.max(0,facilities.indexOf(draft.walk.startFacility))" @change="draft.walk.startFacility=pick($event)?facilities[pick($event)]:''"><view class="field-select">{{draft.walk.startFacility || '选择楼梯、扶梯或电梯'}} <text>⌄</text></view></picker>
        <input v-model="draft.walk.startFacility" class="facility-location" aria-label="下车后的设施位置" placeholder="可补充现场编号，如 A1楼梯、站台中部电梯" maxlength="100" />
        <text class="field-title">乘它上楼还是下楼？<text class="optional">选填</text></text>
        <picker :range="verticalMoves" :value="Math.max(0,verticalMoves.indexOf(draft.walk.startMove as any))" @change="draft.walk.startMove=pick($event)?verticalMoves[pick($event)]:''"><view class="field-select">{{draft.walk.startMove || '未核实，暂不填写'}} <text>⌄</text></view></picker>
        <text class="help">不需要上下楼时，设施与升降方向都可留空，在下一步说明平层走法。</text>
      </view>
      <view v-show="step===1" class="step-content">
        <text class="step-title">沿换乘通道怎么走？</text>
        <text class="field-title">跟随哪个线路的换乘标识？<text class="optional">选填</text></text>
        <input v-model="draft.walk.guideLine" aria-label="换乘标识上的线路" placeholder="照现场标识填写，如 2号线" maxlength="100" />
        <text class="field-title">有转弯、出闸或站外路段吗？<text class="optional">选填</text></text>
        <textarea v-model="draft.walk.special" aria-label="换乘通道走法" placeholder="例如：沿连廊直行，到尽头左转；如需出站，说明出闸和重新进站的走法。" maxlength="1000" />
        <text class="field-title">这一路走了多远、多久？<text class="optional">知道哪项填哪项</text></text>
        <view class="measurement-row"><view><text>距离（米）</text><input v-model="draft.metres" type="digit" aria-label="换乘距离（米）" placeholder="未测量留空" maxlength="20" /></view><view><text>耗时（分钟）</text><input v-model="draft.minutes" type="digit" aria-label="换乘耗时（分钟）" placeholder="可填 2.5" maxlength="20" /></view></view>
        <text class="help">从下车门口计到目标站台候车位置，包含两端设施与通道，不含等车。不要填写系统预设分钟数。</text>
      </view>
      <view v-show="step===2" class="step-content">
        <text class="step-title">最后怎样进入目标站台？</text>
        <text class="destination">{{target ? target.line+' · 往'+target.direction : '请先选择目标线路与方向'}}</text>
        <text class="field-title">到站台前，最后走哪种设施？<text class="optional">选填</text></text>
        <picker :range="facilities" :value="Math.max(0,facilities.indexOf(draft.walk.endFacility))" @change="draft.walk.endFacility=pick($event)?facilities[pick($event)]:''"><view class="field-select">{{draft.walk.endFacility || '选择楼梯、扶梯或电梯'}} <text>⌄</text></view></picker>
        <input v-model="draft.walk.endFacility" class="facility-location" aria-label="进入站台的设施位置" placeholder="可补充现场编号，如 B2扶梯" maxlength="100" />
        <text class="field-title">从这里上楼还是下楼？<text class="optional">选填</text></text>
        <picker :range="verticalMoves" :value="Math.max(0,verticalMoves.indexOf(draft.walk.endMove as any))" @change="draft.walk.endMove=pick($event)?verticalMoves[pick($event)]:''"><view class="field-select">{{draft.walk.endMove || '未核实，暂不填写'}} <text>⌄</text></view></picker>
        <text class="field-title">走出设施后往哪边？<text class="optional">选填</text></text>
        <input v-model="draft.walk.side" aria-label="走出设施后的方向" placeholder="例如：左、右、东；以走出设施的视角填写" maxlength="100" />
        <text class="field-title">还有什么需要说明？<text class="optional">选填</text></text>
        <textarea v-model="draft.description" aria-label="其他换乘记录" placeholder="例如：电梯闸机尚未核实，或标识不清楚的位置。" maxlength="1000" />
      </view>
    </template>
    <view class="step-actions"><button v-if="step>0" @tap="step--">上一步</button><button v-if="step<2" class="next" @tap="step++">下一步：{{steps[step+1]}} →</button><button v-else class="next" @tap="showPreview=!showPreview">{{showPreview?'收起':'查看'}}行走说明</button></view>
    <view v-if="showPreview" class="walking-preview"><text class="field-title">行走说明预览</text><text class="help">方括号表示未知信息，不是已确认指引。</text><text class="preview-text">{{preview}}</text></view>
  </view>
</template>
<style scoped>
.walk-steps{display:flex;border-bottom:1px solid #e5ebe7;gap:4px}.walk-steps button{flex:1;min-width:0;min-height:52px;margin:0;padding:8px 2px;border-radius:0;background:transparent;color:#6a7f70;font-size:14px;display:flex;align-items:center;justify-content:center;gap:5px;line-height:1.4}.walk-steps button::after,.step-actions button::after{border:0}.walk-steps button.active{color:#176b52;border-bottom:3px solid #176b52;font-weight:650}.step-number{font-size:12px;width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;background:#edf3ef;flex-shrink:0}.step-content{padding:18px 0 4px}.step-title{display:block;font-size:19px;line-height:1.5;font-weight:650;color:#294c39}.help{display:block;font-size:13px;color:#6b7f71;line-height:1.7;margin:8px 0}.field-title{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px;font-size:15px;font-weight:600;color:#3e5948;line-height:1.6;margin:19px 0 9px}.optional{font-size:12px;font-weight:400;color:#7c8b81}.transfer-editor input,.transfer-editor textarea,.field-select{box-sizing:border-box;width:100%;font-size:15px;line-height:1.6;background:#f5f8f6;border:1px solid #dfe7e1;border-radius:8px;color:#334f3e;padding:11px 12px;min-height:46px}.transfer-editor textarea{height:108px}.field-select{display:flex;justify-content:space-between;gap:8px;overflow-wrap:anywhere}.field-select+input{margin-top:8px}.measurement-row{display:flex;gap:12px}.measurement-row>view{flex:1;min-width:0}.measurement-row>view>text{font-size:13px;color:#687e6e;display:block;margin-bottom:7px}.step-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.step-actions button{font-size:15px;line-height:1.6;min-height:46px;padding:10px 14px;margin:0;background:#f0f4f1;color:#516d5c}.step-actions .next{background:#176b52;color:#fff}.destination{display:block;font-size:15px;line-height:1.7;color:#176b52;margin-top:6px}.walking-preview{margin-top:18px;border-top:1px solid #e5ebe7}.preview-text{display:block;white-space:pre-wrap;font-size:14px;line-height:1.85;color:#3a5545}
</style>
<style scoped>.transfer-editor .facility-location{margin-top:8px}</style>
