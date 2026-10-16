<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DoorRecommendation, Formation, JourneyLeg, WalkPath } from '../core/types'
import type { PositionChoice } from './route-presentation'
import { facilitiesIn } from './route-presentation'
import FacilityLabel from './FacilityLabel.vue'
const props = defineProps<{ leg: JourneyLeg; formation?: Formation; choices: PositionChoice[]; selected?: DoorRecommendation; path: WalkPath | null; transfer: boolean; demo: boolean }>()
const emit = defineEmits<{ select: [combinationIndex: number] }>()
const details = ref(false)
const facilities = computed(() => facilitiesIn(props.path))
const linked = computed(() => props.choices.some(choice => choice.combinationIndex !== null))
const isSelected = (position: DoorRecommendation) => props.selected?.car === position.car && props.selected?.door === position.door
</script>
<template>
  <view :class="['position-card', { pending: !choices.length }]">
    <view class="position-heading"><text class="position-title">乘车位置</text><text class="position-status">{{ demo ? '演示建议' : leg.recommendationStatus === 'local' ? '局部资料' : choices.length ? '已录入通路' : '待采集' }}</text></view>
    <template v-if="choices.length">
      <text class="position-purpose">{{ !linked ? '局部下车建议 · 仅依据已录入通路' : transfer ? '方便下一次换乘' : '方便前往付费站厅' }}</text>
      <view class="position-choices"><button v-for="choice in choices" :key="choice.position.positionId" :class="['position-choice', { selected: isSelected(choice.position) }]" :aria-label="choice.position.car + '号车厢' + choice.position.door + '号门'" :aria-pressed="isSelected(choice.position)" :disabled="choice.combinationIndex === null" @tap="choice.combinationIndex !== null && emit('select', choice.combinationIndex)"><text class="position-number">{{ choice.position.car }}</text><text>车厢</text><text class="position-separator">·</text><text class="position-number">{{ choice.position.door }}</text><text>门</text><text v-if="isSelected(choice.position)" class="position-check">✓</text></button></view>
      <text v-if="choices.length > 1" class="position-help">以上位置同等最优{{ !linked ? '（仅已录入的局部通路）' : '，点击切换整程组合' }}。</text>
      <view class="facility-row"><FacilityLabel v-for="kind in facilities" :key="kind" :kind="kind"/><text v-if="!facilities.length" class="position-help">{{ path ? '已录入平层通路' : '设施衔接待核实' }}</text></view>
    </template>
    <template v-else><text class="pending-title">车厢与车门待补充</text><text class="position-help">本站设施与门位尚未核实，请按现场导向候车。</text></template>
    <button class="position-toggle" :aria-label="leg.lineName + '乘车位置依据'" :aria-expanded="details" @tap="details = !details"><text>{{ details ? '收起设施与推荐依据' : '设施与推荐依据' }}</text><text class="toggle-sign">{{ details ? '−' : '＋' }}</text></button>
    <view v-if="details" class="position-details">
      <text v-for="(basis, index) in leg.recommendationBasis" :key="index" class="basis-text">{{ basis }}</text>
      <text v-if="path" class="basis-text">所选位置关联{{ transfer ? '换乘' : '到站厅' }}通路：步行 {{ Math.round(path.metres) }} 米{{ path.stairCount ? '，含 ' + path.stairCount + ' 级普通楼梯' : '，无普通楼梯' }}。仅在已录入通路范围内比较。</text>
      <text v-if="!path" class="basis-text">设施位置、连接楼层与通行方向待采集，暂不生成精细推荐。</text>
      <template v-if="!linked && path"><text class="basis-text">首个推荐位置对应的已录入通路：</text><text v-for="(instruction, index) in path.instructions" :key="'local-' + index" class="basis-text">{{ index + 1 }}. {{ instruction }}</text></template>
      <view v-if="formation" class="formation"><view v-for="car in formation.cars" :key="car" :class="['formation-car', { active: selected?.car === car }]"><text>{{ car }}车</text></view></view>
      <text class="basis-text">{{ formation?.cars ?? leg.formationCars ?? '未知' }} 节编组示意，不表示行进方向。{{ formation?.numberingStatus === 'unknown' || !formation?.positions.length ? '每车门数及编号待核实。' : '车厢、车门编号请核对现场标识。' }}</text>
      <text v-if="leg.recommendationStatus === 'local'" class="basis-text local-warning">{{ linked ? '仅在已采集门位与通路范围内比较，尚未覆盖所有实际车门。' : '仅为到达站已录入通路的局部建议，尚未核实完整行程。' }}</text>
    </view>
  </view>
</template>
<style scoped>
.position-card { background: #f0f7f4; border: 1px solid #d8e8df; border-radius: 10px; padding: 12px 12px 0; margin-top: 12px; }
.position-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
.position-title { font-size: 16px; font-weight: 700; color: #173e32; }
.position-status { font-size: 12px; color: #486556; background: #e2eee6; border-radius: 4px; padding: 2px 5px; }
.position-purpose { display: block; font-size: 14px; color: #4c6459; margin-top: 3px; }
.position-choices { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.position-choice { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 4px; min-height: 48px; min-width: 118px; padding: 7px 9px; border: 1px solid #a8c6b6; background: #fff; border-radius: 7px; margin: 0; font-size: 15px; line-height: 1.5; color: #215441; }
.position-choice::after,.position-toggle::after { border: none; }
.position-choice.selected { background: #176b52; border-color: #176b52; color: #fff; }
.position-number { font-size: 23px; line-height: 1.25; font-weight: 750; }.position-separator { margin: 0 2px; }.position-check { font-size: 14px; margin-left: 3px; }
.position-help { display: block; font-size: 13px; line-height: 1.65; color: #4d655a; margin-top: 7px; }
.facility-row { display: flex; flex-wrap: wrap; gap: 7px 12px; margin-top: 10px; padding-bottom: 8px; }.facility-row .position-help { margin: 0; }
.position-toggle { min-height: 48px; padding: 9px 0; display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; border-top: 1px solid #d7e6dd; margin: 0; border-radius: 0; background: transparent; color: #375c4d; text-align: left; font-size: 14px; line-height: 1.5; }.toggle-sign { font-size: 19px; }
.position-details { border-top: 1px solid #d7e6dd; padding: 10px 0 12px; }.basis-text { display: block; font-size: 13px; line-height: 1.8; color: #4c6358; overflow-wrap: anywhere; }.basis-text + .basis-text { margin-top: 6px; }
.formation { display: flex; gap: 4px; margin: 12px 0 8px; }.formation-car { flex: 1; min-width: 0; text-align: center; border: 1px solid #c6d8cd; background: #fff; padding: 5px 0; border-radius: 4px; font-size: 13px; color: #52685c; }.formation-car.active { background: #176b52; color: #fff; border-color: #176b52; }
.local-warning { color: #795b28; }.pending { background: #f5f7f7; border-color: #e1e7e6; }.pending-title { display: block; font-size: 18px; font-weight: 650; color: #4c5e5b; margin-top: 8px; }.pending .position-help { margin: 4px 0 10px; }.pending .position-status { background: #e9eeec; color: #526561; }.pending .position-toggle { border-top-color: #dfe6e3; }
@media (max-width: 359px) { .position-card { padding-left: 10px; padding-right: 10px; }.position-choice { min-width: 108px; padding-left: 7px; padding-right: 7px; } }
</style>
