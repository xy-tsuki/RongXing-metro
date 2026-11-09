<script setup lang="ts">
import { nextTick } from 'vue'
import { onBackPress, onHide, onPageScroll, onReady, onShow } from '@dcloudio/uni-app'
import JourneyPlanner from '../../components/JourneyPlanner.vue'
import { useJourneySession } from '../../navigation/session'
const session=useJourneySession()
const restoreScroll=session.detailScrollTop.value
let restoring=true
let active=true
let restoreTimer: ReturnType<typeof setTimeout> | undefined
onShow(()=>{active=true})
onHide(()=>{active=false;if(restoreTimer)clearTimeout(restoreTimer)})
onBackPress(()=>{active=false;return false})
onPageScroll(event=>{if(active&&!restoring)session.detailScrollTop.value=event.scrollTop})
// Run after the router's own post-render scroll reset, using the cross-platform API.
onReady(()=>{void nextTick(()=>{restoreTimer=setTimeout(()=>{
  if(active)uni.pageScrollTo({scrollTop:restoreScroll,duration:0,complete:()=>{restoring=false}})
},0)})})
</script>
<template><JourneyPlanner stage="details"/></template>
