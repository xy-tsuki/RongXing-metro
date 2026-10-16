<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
onLaunch(() => { /* App lifecycle shared by H5 and WeChat. */ })
</script>
<style>
page { background: #ffffff; color: #243e35; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 14px; }
view, text, button, input, scroll-view { box-sizing: border-box; }
button { margin: 0; padding: 0; border-radius: 0; font-size: inherit; line-height: inherit; background: transparent; color: inherit; }
button::after { border: none; }
/* #ifdef H5 */
uni-button { margin: 0; padding: 0; border-radius: 0; font-size: inherit; line-height: inherit; background: transparent; color: inherit; }
uni-button::after { border: none; }
/* #endif */
</style>
