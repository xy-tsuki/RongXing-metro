<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import JourneyPlanner from '../../components/JourneyPlanner.vue'
const fixture = ref('')
onLoad(options => {
  if (import.meta.env.DEV && ['long-names', 'blocked-lift'].includes(options?.fixture ?? '')) fixture.value = options!.fixture!
})
</script>
<template><JourneyPlanner :fixture="fixture" /></template>
