<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 35 })
</script>
<template><image class="brand-logo" src="/static/brand/E-badge-clean-144.png" mode="aspectFit" aria-label="榕乘标志" :style="{width:size+'px',height:size+'px'}"/></template>
<style scoped>
.brand-logo{display:block;flex-shrink:0}
</style>
