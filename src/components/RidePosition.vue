<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Formation, JourneyLeg, WalkPath } from '../core/types'
import type { FacilityKind, PositionChoice } from './route-presentation'
import { groupEquivalentPositions } from './route-presentation'
import FacilityLabel from './FacilityLabel.vue'
const props = defineProps<{ leg: JourneyLeg; formation?: Formation; choices: PositionChoice[]; path: WalkPath | null; demo: boolean; facilities: FacilityKind[]; linked: boolean }>()
const details = ref(false)
const groups = computed(() => groupEquivalentPositions(props.choices))
</script>
<template>
  <view class="ride-position">
    <view v-if="groups.length" class="recommendation-row">
      <text class="recommendation-label">推荐</text>
      <view class="position-groups"><view v-for="group in groups" :key="group.car" class="position-group"><text class="position-number">{{ group.car }}</text><text class="position-unit">车厢</text><text class="position-separator">·</text><text class="position-number">{{ group.doors.join('、') }}</text><text class="position-unit">门</text></view></view>
    </view>
    <text v-else class="position-pending">车厢、车门待补充</text>
    <view class="position-meta">
      <view class="facility-list"><FacilityLabel v-for="kind in facilities" :key="kind" :kind="kind"/><text v-if="!facilities.length" class="meta-note">{{ path ? '平层通路' : '门位与设施待核实' }}</text><text v-if="leg.recommendationStatus === 'local'" class="local-label">局部建议</text></view>
      <button class="disclosure" :aria-label="leg.lineName + '乘车位置依据'" :aria-expanded="details" @tap="details = !details">依据 <text>{{ details ? '−' : '⌄' }}</text></button>
    </view>
    <view v-if="details" class="position-details">
      <text v-if="choices.length > 1" class="detail-text">所列门号同等推荐，仅在已录入通路内比较。</text>
      <text v-if="demo" class="detail-text">合成演示建议，不用于真实乘车。</text>
      <text v-for="(basis, index) in leg.recommendationBasis" :key="index" class="detail-text">{{ basis }}</text>
      <text v-if="path" class="detail-text">一组相容搭配对应通路：步行 {{ Math.round(path.metres) }} 米，{{ path.stairCount ? path.stairCount + ' 级普通楼梯' : '无普通楼梯' }}。不同乘车段请按同一整程搭配使用。</text>
      <text v-else class="detail-text">设施位置、连接楼层与通行方向待采集。</text>
      <template v-if="!linked && path"><text class="detail-text">首个局部位置对应的已录入通路：</text><text v-for="(instruction, index) in path.instructions" :key="index" class="detail-text">{{ index + 1 }}. {{ instruction }}</text></template>
      <view v-if="formation" class="formation"><text v-for="car in formation.cars" :key="car" class="formation-car">{{ car }}车</text></view>
      <text class="detail-text">{{ formation?.cars ?? leg.formationCars ?? '未知' }} 节编组，不表示行进方向。{{ formation?.numberingStatus === 'unknown' || !formation?.positions.length ? '门数和编号待核实。' : '编号以现场标识为准。' }}</text>
      <slot/>
    </view>
  </view>
</template>
<style scoped>
.ride-position { margin-top: 4px; }
.recommendation-row { display: flex; align-items: baseline; gap: 10px; }
.recommendation-label { font-size: 13px; color: #567065; flex-shrink: 0; }
.position-groups { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.position-group { display: flex; flex-wrap: wrap; align-items: baseline; gap: 5px; color: #185b43; }
.position-number { font-size: 26px; font-weight: 750; line-height: 1.4; overflow-wrap: anywhere; }
.position-unit { font-size: 15px; font-weight: 550; }.position-separator { color: #87988e; margin: 0 2px; }
.position-meta { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0 8px; }
.facility-list { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 10px; min-height: 40px; }
.meta-note,.local-label { font-size: 13px; line-height: 1.6; color: #64756c; }.local-label { color: #82652e; }
.disclosure { margin: 0; min-height: 44px; padding: 8px 0 8px 8px; background: transparent; color: #64756c; font-size: 13px; line-height: 1.6; display: flex; align-items: center; gap: 8px; border-radius: 0; }
.disclosure::after { border: none; }
.position-pending { display: block; color: #5c6d63; font-size: 17px; font-weight: 600; line-height: 1.65; margin-top: 6px; }
.position-details { padding: 10px 0 12px; border-top: 1px solid #e8ede9; }
.detail-text { display: block; font-size: 14px; color: #56685f; line-height: 1.75; margin-bottom: 7px; overflow-wrap: anywhere; }
.formation { display: flex; gap: 4px; margin: 12px 0 8px; }.formation-car { flex: 1; min-width: 0; padding: 5px 0; text-align: center; font-size: 13px; color: #617268; border-bottom: 2px solid #c5d2ca; }
</style>
