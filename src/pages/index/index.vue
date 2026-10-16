<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import JourneyPlanner from '../../components/JourneyPlanner.vue'
const fixture = ref('')
onLoad(options => {
  if (import.meta.env.DEV && options?.fixture === 'long-names') fixture.value = 'long-names'
})
</script>
<template><JourneyPlanner :fixture="fixture" /></template>