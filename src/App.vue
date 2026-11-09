<script setup lang="ts">
import { onShow, onHide } from '@dcloudio/uni-app'
import { refreshPublishedData } from './data/published'
let timer: ReturnType<typeof setInterval> | undefined
onShow(() => {
  void refreshPublishedData()
  if (!timer) timer = setInterval(() => { void refreshPublishedData() }, 60000)
})
onHide(() => { if (timer) clearInterval(timer); timer = undefined })
</script>
<style>
page { --rx-brand: #176b52; --rx-text: #273d33; --rx-muted: #78867c; --rx-surface: #f4f7f5; background: #ffffff; color: #243e35; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 14px; }
view, text, button, input, scroll-view { box-sizing: border-box; }
button { margin: 0; padding: 0; border-radius: 0; font-size: inherit; line-height: inherit; background: transparent; color: inherit; }
button::after { border: none; }
/* #ifdef H5 */
uni-button { margin: 0; padding: 0; border-radius: 0; font-size: inherit; line-height: inherit; background: transparent; color: inherit; }
uni-button::after { border: none; }
/* #endif */
</style>
