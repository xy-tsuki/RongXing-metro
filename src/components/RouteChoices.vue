<script setup lang="ts">
import { transitDisplayText, lineDisplayCode } from '../navigation/line-display'
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { DisplayCandidate, DepartureWindow } from '../navigation/departures'
import { BOARD_TOP, MINUTE_PIXELS, candidateGeometry, columnMetrics, diagonalDrag } from '../navigation/departures'
import { arrivalDayLabel, clockText } from '../navigation/timing'
import { BOARD_FOOTER, fitBoardCamera, quarterHourTicks, snapBoardX } from '../navigation/board-camera'
import { capsuleLayout, minimumCapsuleHeight } from '../navigation/capsule-layout'
import { animateBoard } from '../navigation/board-motion'
import { boardGestureAxis, type BoardGestureAxis } from '../navigation/board-gesture'
import { scheduleLabel } from '../navigation/schedule-presentation'
import JourneyFare from './JourneyFare.vue'
import { farePresentation } from '../navigation/fare-presentation'
const props = defineProps<{ candidates: DisplayCandidate[]; current: string; window: DepartureWindow; timed: boolean; demo: boolean; position: { x: number; y: number }; scheduleScope?: string; calendarNote?: string; cityId?: string; networkVersion?: string; fromStationId?: string; toStationId?: string }>()
const emit = defineEmits<{ open: [id: string]; 'update:position': [position: { x: number; y: number }] }>()
const instance = getCurrentInstance()
const viewportWidth = ref(340), viewportHeight = ref(560)
const metrics = computed(() => columnMetrics(viewportWidth.value))
const inset = computed(() => props.candidates.length < 4 ? (viewportWidth.value - props.candidates.length * metrics.value.stride + 6) / 2 : metrics.value.inset)
const rawShapes = computed(() => props.candidates.map(item => candidateGeometry(item, props.window, props.timed)))
const timeScale = ref(1)
const capsules = computed(() => props.candidates.map((item, index) => capsuleLayout(item, rawShapes.value[index].height * timeScale.value, props.timed)))
const shapes = computed(() => rawShapes.value.map((shape, index) => ({top: BOARD_TOP + (shape.top - BOARD_TOP) * timeScale.value, height: capsules.value[index].height})))
const minimumViewportHeight = computed(() => BOARD_TOP + BOARD_FOOTER + 24 + Math.max(0, ...props.candidates.map(item => minimumCapsuleHeight(item.route.legs.length))))
const canvasWidth = computed(() => Math.max(viewportWidth.value + (props.candidates.length > 3 ? 16 : 0), 16 + props.candidates.length * metrics.value.stride))
const canvasHeight = computed(() => Math.max(viewportHeight.value, ...shapes.value.map(shape => shape.top + shape.height + BOARD_FOOTER)))
const maxX = computed(() => Math.max(0, canvasWidth.value - viewportWidth.value))
const pan = ref({ ...props.position }), dragging = ref(false)
const selected = computed(() => props.candidates.find(item => item.id === props.current))
const candidateFares = computed(() => props.candidates.map(item => farePresentation({cityId:props.cityId, networkVersion:props.networkVersion, from:props.fromStationId, to:props.toStationId, route:item.route, demo:props.demo})))
const baselineTop = computed(() => BOARD_TOP - pan.value.y)
const baselinePinned = computed(() => baselineTop.value < 18)
const queryLabel = computed(() => {
  const cityDate = new Date(Date.parse(props.window.startAt) + 480 * 60_000).toISOString().slice(5, 10).replace('-', '/')
  return `${cityDate} ${clockText(props.window.startAt)}—${clockText(props.window.endAt)}${arrivalDayLabel(props.window.startAt, props.window.endAt) ? '（跨日）' : ''}`
})
const gridTicks = computed(() => {
  const end = Math.max(Date.parse(props.window.endAt), ...props.candidates.map(item => Date.parse(item.timing.route?.arrivalAt ?? props.window.endAt)))
  return quarterHourTicks(props.window.startAt, new Date(end).toISOString()).map(tick => ({
    ...tick, top: BOARD_TOP + tick.minutes * MINUTE_PIXELS * timeScale.value,
  }))
})
watch(() => props.position, value => { if (!dragging.value) pan.value = { ...value } })
function publish(x: number, y: number) { pan.value = { x, y }; emit('update:position', { x, y }) }
let cancelMotion = () => {}
function fit(x: number, preferredY?: number, animate = true) {
  const frame = fitBoardCamera({x, viewportWidth:viewportWidth.value, viewportHeight:viewportHeight.value,
    stride:metrics.value.stride, columnWidth:metrics.value.width, inset:inset.value, shapes:rawShapes.value, timed:props.timed, preferredY})
  cancelMotion()
  const render = (value: typeof frame) => { timeScale.value = value.scale; publish(value.x, value.y) }
  if (!animate) { render(frame); return }
  // Keep horizontal dragging immediate. Only auto-fit Y/zoom eases while the finger moves.
  if (dragging.value) publish(frame.x, pan.value.y)
  cancelMotion = animateBoard({ ...pan.value, scale: timeScale.value }, frame, render)
}
function measure() {
  const info = uni.getSystemInfoSync()
  let bottomInset = 0
  // H5 screen and viewport can use different dimensions (desktop/mobile preview).
  // Only the native mini-program screen geometry provides this bottom inset.
  // #ifdef MP-WEIXIN
  bottomInset = Math.max(0, info.screenHeight - (info.safeArea?.bottom ?? info.screenHeight))
  // #endif
  const footerSpace = 68 + bottomInset
  viewportHeight.value = Math.max(minimumViewportHeight.value, props.timed ? Math.max(460, Math.min(650, info.windowHeight * .72))
    : Math.max(350, ...rawShapes.value.map(shape => shape.top + shape.height + BOARD_FOOTER)))
  nextTick(() => {
    const query = uni.createSelectorQuery().in(instance?.proxy)
    query.select('.timeline-viewport').boundingClientRect()
    query.selectViewport().scrollOffset(() => {})
    query.exec(results => {
      const bounds = results?.[0] as { width?: number; top?: number } | undefined
      const scroll = results?.[1] as { scrollTop?: number } | undefined
      if (bounds?.width) {
        viewportWidth.value = bounds.width
        // Router scroll restoration may still be running at mount. Measure the page position,
        // rather than accidentally treating a scrolled board as having more screen space.
        const pageTop = (bounds.top ?? 0) + (scroll?.scrollTop ?? 0)
        viewportHeight.value = Math.max(320, minimumViewportHeight.value, Math.min(618, info.windowHeight - Math.max(0, pageTop) - footerSpace))
      }
      fit(snapBoardX(pan.value.x, maxX.value, metrics.value.stride), undefined, false)
    })
  })
}
onMounted(() => { measure(); uni.onWindowResize(measure) })
watch(rawShapes, measure)
onUnmounted(() => { cancelMotion(); uni.offWindowResize(measure) })
type Pointer = { clientX: number; clientY: number }
type Gesture = { touches?: ArrayLike<Pointer>; changedTouches?: ArrayLike<Pointer>; clientX?: number; clientY?: number; buttons?: number; cancelable?: boolean; preventDefault?: () => void }
let start = { x: 0, y: 0, panX: 0, panY: 0 }, axis: BoardGestureAxis = '', moved = false, ignoreTapUntil = 0
function begin(event: Gesture) {
  const point = event.touches?.[0] ?? event
  if (point.clientX === undefined || point.clientY === undefined) return
  cancelMotion()
  start = { x: point.clientX, y: point.clientY, panX: pan.value.x, panY: pan.value.y }; axis = ''; moved = false; dragging.value = true
}
function move(event: Gesture) {
  if (!dragging.value) return
  const point = event.touches?.[0] ?? event
  if (point.clientX === undefined || point.clientY === undefined) return
  const dx = point.clientX - start.x, dy = point.clientY - start.y
  axis = boardGestureAxis(axis, dx, dy)
  if (!axis) return
  moved = true
  if (axis === 'horizontal') {
    if (event.cancelable) event.preventDefault?.()
    const next = diagonalDrag(start.panX, start.panY, dx, maxX.value)
    // Follow the 15-degree gesture, clamped to keep the focused three complete.
    fit(next.x, next.y)
  }
}
function settle() {
  if (!dragging.value) return
  dragging.value = false
  if (!moved) return
  ignoreTapUntil = Date.now() + 250
  if (axis === 'horizontal') fit(snapBoardX(pan.value.x, maxX.value, metrics.value.stride))
}
function mouseLeave() { if (dragging.value) settle() }
function select(id: string) { if (Date.now() >= ignoreTapUntil) emit('open', id) }
function railPart(candidate: number, index: number) {
  const part = capsules.value[candidate].parts[index]
  return { top: part.top + 'px', height: part.height + 'px' }
}
const code = lineDisplayCode
function transferLabel(candidate: number, index: number) {
  return { top: capsules.value[candidate].parts[index].transferOffset + 'px' }
}
function duration(item: DisplayCandidate) {
  return props.timed ? Math.ceil((Date.parse(item.timing.route!.arrivalAt!) - Date.parse(item.timing.route!.departureAt!)) / 60_000) + '分' : '线路示意'
}
function description(item: DisplayCandidate) { return `${duration(item)}，${clockText(item.timing.route?.departureAt) ?? '时刻待接入'}，${item.route.transferCount}次换乘，点击查看精细指引` }
</script>
<template>
  <view class="route-choices">
    <view class="choices-heading"><text class="choices-title">{{ timed?'沿着时间，选这一程':'选一条顺路的方案' }}</text><text class="choices-count">{{ candidates.length }} {{ timed?'趟':'种' }}</text></view>
    <view class="window-row"><text :class="['schedule-source',{demo}]">{{ timed?(demo?'模拟班次 · 非真实时刻':scheduleScope||'班次时刻'):'本版时刻未覆盖' }}</text><text class="window-label">{{ queryLabel }} 出发</text></view>
    <text v-if="!timed" class="untimed-note">以下比较线路与换乘；竖线为路线示意，不表示时间长短。</text>
    <view v-if="!candidates.length" class="no-departures">{{calendarNote || '本版数据在这30分钟内没有可用班次，请修改出发时间；不代表实际停运。'}}</view>
    <view v-else class="timeline-viewport" :style="{height:viewportHeight+'px'}" aria-label="路线时间轴，左右滑动比较，上下滑动页面，点击时间线进入详情"
      @touchstart="begin" @touchmove="move" @touchend="settle" @touchcancel="settle"
      @mousedown="begin" @mousemove="move" @mouseup="settle" @mouseleave="mouseLeave">
      <view :class="['time-canvas',{dragging}]" :data-pan-x="pan.x" :data-pan-y="pan.y" :data-time-scale="timeScale" :style="{width:canvasWidth+'px',height:canvasHeight+'px',transform:`translate(${-pan.x}px, ${-pan.y}px)`}">
        <view v-if="timed" class="time-grid query" :style="{top:BOARD_TOP+'px'}"/>
        <template v-if="timed"><view v-for="(tick,i) in gridTicks" :key="i" class="time-grid" :data-at="tick.at" :style="{top:tick.top+'px'}"/></template>
        <button v-for="(item,i) in candidates" :key="item.id" :class="['candidate',{chosen:current===item.id}]" :data-run-id="item.id" :aria-label="description(item)" :aria-pressed="current===item.id"
          :style="{left:inset+i*metrics.stride+'px',top:shapes[i].top-50+'px',width:metrics.width+'px'}" @tap="select(item.id)">
          <text class="candidate-duration">{{ duration(item) }}</text><text class="candidate-depart">{{ timed?clockText(item.timing.route?.departureAt):'时刻待补' }}</text>
          <view class="candidate-capsule" :style="{height:shapes[i].height+'px','--detail-scale':capsules[i].detailScale}"><view class="capsule-backbone"/>
            <view v-for="(leg,li) in item.route.legs" :key="li" :class="['candidate-leg', 'anchor-' + capsules[i].parts[li].anchor]" :style="railPart(i,li)"><view class="candidate-line" :style="{backgroundColor:leg.lineColor}"/><text :class="['line-code',{'long-code':code(leg.lineName).length>1}]" :style="{borderColor:leg.lineColor}">{{ code(leg.lineName) }}</text><text v-if="li" class="candidate-transfer" :aria-label="leg.fromStationName" :style="transferLabel(i,li)">{{ leg.fromStationName }}</text></view>
            <view v-if="!item.route.legs.length" class="walk-only">步行衔接</view>
          </view>
          <text class="candidate-arrive">{{ timed?clockText(item.timing.route?.arrivalAt):item.route.legs.reduce((sum,leg)=>sum+leg.stopCount,0)+'站' }}</text>
          <text v-if="timed&&arrivalDayLabel(item.timing.route?.departureAt,item.timing.route?.arrivalAt)" class="arrival-day">{{ arrivalDayLabel(item.timing.route?.departureAt,item.timing.route?.arrivalAt) }}</text>
          <JourneyFare :value="candidateFares[i]" compact />
          <view class="transfer-count"><text>{{ item.route.transferCount?'换乘':'直达' }}</text><text v-if="item.route.transferCount">{{ item.route.transferCount }}次</text></view>
          <text v-if="current===item.id" class="path-name">已选</text>
          <text v-if="item.timing.route?.schedule" class="run-source">{{scheduleLabel(item.timing.route.schedule,true)}}</text>
        </button>
      </view>
      <template v-if="timed"><text v-for="tick in gridTicks" :key="tick.at" class="grid-clock" :style="{top:tick.top-pan.y+'px'}">{{clockText(tick.at)}}</text></template>
      <view v-if="timed" :class="['query-baseline',{pinned:baselinePinned,dragging}]" :style="{top:Math.max(18,baselineTop)+'px'}"><text class="query-clock" :aria-label="'查询起始时间 '+clockText(window.startAt)+(baselinePinned?'，基准线在上方':'')">{{ baselinePinned?'↑ ':'' }}{{ clockText(window.startAt) }}</text></view>
    </view>
    <view v-if="candidates.length" class="board-hint">左右滑动比较 · 点击时间线查看指引<text class="scale-note">{{ timed ? '灰线间隔15分钟 · 所有方案使用同一时间比例' : '线路示意 · 不表示耗时比例' }}</text></view>
    <text v-if="candidateFares.some(Boolean)" class="fare-board-note">成人票价 · 闸内按最短路径计费，出站换乘分段相加</text>
    <view v-if="selected" class="selected-summary"><view class="selected-route"><text v-for="(leg,li) in selected.route.legs" :key="li" class="summary-line"><text v-if="li" class="summary-arrow">→</text><text :style="{borderColor:leg.lineColor}">{{ transitDisplayText(leg.lineName).replace('演示','') }}</text></text><text v-if="!selected.route.legs.length">出站步行衔接</text></view><text class="summary-stations">{{ selected.route.transfers.map(transfer=>transfer.stationName).join(' → ') || '无需换乘' }}{{ selected.route.walkingMetres!==null?' · 步行 '+Math.round(selected.route.walkingMetres)+'米':'' }}</text></view>
  </view>
</template>
<style scoped>
.run-source{display:block;color:#677a6d;font-size:12px;line-height:1.5;margin-top:3px}
</style>
<style scoped>
.route-choices{padding-bottom:8px}.choices-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:20px 0 10px}.choices-title{font-size:22px;font-weight:700;color:#2b4535;line-height:1.5}.choices-count{font-size:13px;color:#7c8e81;flex-shrink:0}.window-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:13px;font-size:12px;line-height:1.7}.schedule-source{color:#74877b}.schedule-source.demo{color:#9a773c}.window-label{color:#55715f;font-variant-numeric:tabular-nums}.untimed-note{display:block;color:#78877c;font-size:12px;line-height:1.7;margin:-3px 0 12px}.timeline-viewport{width:100%;position:relative;overflow:hidden;touch-action:pan-y;user-select:none;border-bottom:1px solid #edf0ee;cursor:grab}.timeline-viewport:active{cursor:grabbing}.query-baseline{position:absolute;left:0;right:0;height:0;background:transparent;pointer-events:none;z-index:5;transition:none}.query-baseline.dragging{transition:none}.query-baseline.pinned{background:transparent}.query-clock{position:absolute;right:0;top:50%;transform:translateY(-50%);background:#fff;padding:2px 0 2px 7px;color:#548e9e;font-size:14px;line-height:1.5;font-weight:700;font-variant-numeric:tabular-nums}.board-hint{padding:8px 0;color:#7f8d83;font-size:12px;line-height:1.7;text-align:center}.time-canvas{position:relative;transition:none;will-change:transform}.time-canvas.dragging{transition:none}.candidate,.candidate-capsule,.candidate-leg{transition:none}.time-grid{position:absolute;left:0;right:0;height:1px;background:#edf0ee;pointer-events:none}.time-grid text{position:sticky;left:0;display:inline-block;transform:translateY(-100%);font-size:10px;line-height:1.5;color:#a2ada6;background:#fff;padding:0 2px}.time-grid.query{height:2px;background:#8fc0cb}.time-grid.query text{color:#6c9eaa}.candidate{position:absolute;overflow:visible;background:transparent;margin:0;padding:0;border-radius:0;text-align:center;color:#405b49;line-height:1.4;font-size:13px}.candidate::after{border:none}.candidate-duration{display:block;height:24px;font-size:19px;line-height:24px;font-weight:750;color:#536a5b;background:#fff;font-variant-numeric:tabular-nums}.candidate-depart{display:block;height:26px;font-size:19px;font-weight:750;line-height:25px;color:#458367;background:#fff;font-variant-numeric:tabular-nums}.candidate-capsule{position:relative;width:100%;background:#f0f1f3;border-radius:48px;box-sizing:border-box;overflow:visible}.chosen .candidate-capsule{box-shadow:inset 0 0 0 2px #77a48b}.capsule-backbone{position:absolute;left:50%;top:3px;bottom:3px;border-left:2px dotted #b3bcb6;transform:translateX(-1px)}.candidate-leg{position:absolute;left:0;right:0;display:flex;align-items:center;justify-content:center}.candidate-line{position:absolute;left:50%;width:8px;top:0;bottom:0;transform:translateX(-50%);border-radius:5px}.line-code{position:relative;z-index:1;box-sizing:border-box;min-width:33px;max-width:calc(100% - 10px);min-height:33px;display:flex;align-items:center;justify-content:center;padding:2px 4px;border:4px solid;border-radius:4px;background:#fff;font-size:18px;line-height:1.2;font-weight:800;overflow-wrap:anywhere;color:#314639!important}.long-code{font-size:14px;white-space:nowrap}.candidate-transfer{position:absolute;left:2px;right:2px;top:0;transform:translateY(-50%);background:#f0f1f3;padding:3px 1px;color:#5e7064;font-size:11px;line-height:1.25;font-weight:600;overflow-wrap:anywhere}.candidate-transfer{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;max-height:31px}.candidate-arrive{display:block;margin-top:8px;font-size:20px;font-weight:750;color:#458367;line-height:1.4;font-variant-numeric:tabular-nums}.arrival-day{display:block;font-size:11px;color:#789183}.transfer-count{margin:6px auto 0;min-height:40px;width:46px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#f0f1f3;color:#65796b;font-size:12px;line-height:1.3;font-weight:650;padding:3px}.path-name{display:block;font-size:11px;color:#8b978f;margin-top:6px;line-height:1.5}.chosen .path-name{color:#176b52;font-weight:650}.walk-only{position:absolute;inset:20px 0;display:flex;align-items:center;justify-content:center;color:#7e9184;font-size:14px}.selected-summary{border-top:1px solid #edf0ee;padding:14px 0 5px}.selected-route{display:flex;gap:6px;flex-wrap:wrap;align-items:center;color:#3e5947;font-size:14px;font-weight:650}.summary-line{display:inline-flex;align-items:center;gap:7px}.summary-line>text:last-child{border-left:3px solid;padding-left:6px;line-height:1.3}.summary-arrow{font-weight:400;color:#9ba99f}.summary-stations{display:block;font-size:13px;color:#7c8b81;line-height:1.7;margin-top:7px;overflow-wrap:anywhere}.no-departures{padding:50px 15px;color:#74877b;text-align:center;font-size:15px;line-height:1.8}@media(max-width:359px){.candidate-duration,.candidate-depart{font-size:17px}.candidate-transfer{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;max-height:31px}.candidate-arrive{font-size:18px}.line-code{font-size:16px;min-width:29px;min-height:30px;border-width:3px}.long-code{font-size:14px;white-space:nowrap}.candidate-transfer{font-size:10px}.choices-title{font-size:20px}}
</style>

<style scoped>
.candidate-capsule { overflow: hidden; border-radius: 999px; }
.capsule-backbone { top: 16px; bottom: 16px; }
.candidate-leg { min-height: 0; }
.line-code { width: 36px; min-width: 36px; height: 36px; min-height: 36px; padding: 0; }
.long-code { font-size: 14px; }
.candidate-transfer { font-size: calc(11px * var(--detail-scale)); padding: calc(3px * var(--detail-scale)) 1px; }
.anchor-start { align-items: flex-start; }.anchor-start .candidate-line { top: 18px; }
.anchor-end { align-items: flex-end; }.anchor-end .candidate-line { bottom: 18px; }
.grid-clock { position:absolute; right:0; transform:translateY(-100%); color:#7c8b81; background:#fff; font-size:10px; padding-left:4px; pointer-events:none; }
.scale-note { display: block; margin-top: 3px; color: #718477; }
</style>
<style scoped>.fare-board-note{display:block;font-size:12px;line-height:1.7;color:#718477;margin:0 0 10px;text-align:center}</style>
