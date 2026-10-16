<script setup lang="ts">
import { facilityNames } from './route-presentation'
import type { FacilityKind } from './route-presentation'
defineProps<{ kind: FacilityKind }>()
</script>
<template>
  <view class="facility-label"><view :class="['facility-icon', kind]" aria-hidden="true"><view v-if="kind === 'stairs'" class="stair-steps"/><view v-else-if="kind === 'escalator'" class="escalator-slope"/><text v-else class="lift-arrows">↕</text></view><text>{{ facilityNames[kind] }}</text></view>
</template>
<style scoped>
.facility-label { display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600; line-height: 1.5; color: #35564f; }
.facility-icon { width: 24px; height: 24px; border-radius: 5px; background: #e4eeeb; display: flex; align-items: center; justify-content: center; position: relative; flex-shrink: 0; }
.stair-steps { width: 5px; height: 5px; border-top: 2px solid #35564f; border-right: 2px solid #35564f; position: absolute; left: 5px; bottom: 5px; box-shadow: 4px -4px 0 -1px #e4eeeb; }
.stair-steps::before,.stair-steps::after { content: ''; position: absolute; width: 5px; height: 5px; border-top: 2px solid #35564f; border-right: 2px solid #35564f; }
.stair-steps::before { left: 3px; top: -6px; }.stair-steps::after { left: 8px; top: -11px; }
.escalator-slope { width: 17px; height: 6px; border: 2px solid #35564f; border-radius: 4px; transform: rotate(-42deg); }
.escalator-slope::before { content: ''; position: absolute; width: 4px; height: 4px; border-radius: 50%; background: #35564f; top: -7px; left: 5px; }
.lift-arrows { border: 1.5px solid #35564f; border-radius: 2px; height: 18px; width: 15px; text-align: center; font-size: 16px; line-height: 16px; font-weight: 700; }
</style>
