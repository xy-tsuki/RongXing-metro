<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { MetroDataset } from '../core/types'
import { emptyStationPatch, mergeStationPatch, parsePositions, parseStationCsv, stationPatchToCsv, stationServices } from './station-patch'
import type { StationPatch, StationNodeRow, StationPathRow } from './station-patch'
import { singleStationExample } from './example'

const props = defineProps<{ dataset: MetroDataset; initialStationId?: string; saveError?: string }>()
const emit = defineEmits<{ (e: 'import', data: MetroDataset): void; (e: 'close'): void }>()
const stationIndex = ref(Math.max(0, props.dataset.stations.findIndex(s => s.id === props.initialStationId))), lineIndex = ref(0), directionIndex = ref(0)
const stationName = computed(() => props.dataset.stations[stationIndex.value]?.name ?? '')
const patch = ref<StationPatch>(emptyStationPatch(props.dataset, props.dataset.stations[stationIndex.value].name))
const error = ref(''), message = ref(''), csv = ref(''), active = ref<'node' | 'path' | 'manual' | 'csv'>('node')
const availableServices = computed(() => stationServices(props.dataset, stationName.value))
const lines = computed(() => props.dataset.lines.filter(l => availableServices.value.some(s => s.lineId === l.id)))
const directions = computed(() => availableServices.value.filter(s => s.lineId === lines.value[lineIndex.value]?.id))
const lineName = computed(() => lines.value[lineIndex.value]?.name ?? '')
const directionName = computed(() => directions.value[directionIndex.value]?.direction ?? '')
watch(stationIndex, () => { patch.value = emptyStationPatch(props.dataset, stationName.value); lineIndex.value = 0; directionIndex.value = 0; error.value = ''; message.value = ''; csv.value = '' })
watch(lineIndex, () => { directionIndex.value = 0 })
const choose = (e: any) => Number(e.detail.value)
const checked = (e: any) => Boolean(e.detail.value)
const nodeTypes = ['站厅 / 公共到达点', '设施口（如电梯入口）', '车门位置', '通道衔接点']
const nodeKinds = ['concourse', 'facility', 'door', 'corridor'] as const
const nodeType = ref(1), nodeLabel = ref(''), level = ref(''), car = ref(''), door = ref('')
const nodeUnknown = ref(false)
const allLabels = computed(() => [...new Set([...props.dataset.walkNodes.filter(n => n.stationId === props.dataset.stations[stationIndex.value]?.id).map(n => n.label), ...patch.value.nodes.map(n => n.label)])])
const fromIndex = ref(0), toIndex = ref(0), pathType = ref(0), pathKinds = ['walk', 'stairs', 'escalator', 'lift'] as const
const pathTypes = ['平层步行', '普通楼梯', '扶梯', '电梯']
const metres = ref(''), seconds = ref(''), stairCount = ref(''), wheelchairIndex = ref(0), bidirectional = ref(true), pathUnknown = ref(false)
const wheelchairLabels = ['未确认轮椅通行', '已确认可通行', '已确认不可通行']
const manualName = ref(''), manualPositions = ref(''), manualNote = ref(''), manualPurpose = ref(0), targetIndex = ref(0)
const targetOptions = computed(() => availableServices.value.map(s => `${props.dataset.lines.find(l => l.id === s.lineId)?.name} · 往${s.direction}`))
const sourceTypes = ['现场核实', '用户提供待复核', '官方资料', '合成演示（禁用作实乘导航）']
const sourceKinds = ['survey', 'user', 'official', 'demo'] as const
const sourceIndex = computed(() => Math.max(0, sourceKinds.indexOf(patch.value.provenance.kind as any)))
const pendingCount = computed(() => patch.value.nodes.length + patch.value.paths.length + patch.value.manualRecommendations.length)
const completeSource = () => { if (!patch.value.provenance.source.trim() || !patch.value.provenance.recordedAt) throw new Error('请先填写资料来源与核实日期') }
function handle(action: () => void) { error.value = ''; message.value = ''; try { action() } catch (e) { error.value = (e as Error).message } }
function addNode() { handle(() => {
  if (!nodeLabel.value.trim() || level.value.trim() === '' || !Number.isFinite(Number(level.value))) throw new Error('填写节点名称与楼层（B1 填 -1，地面填 0）')
  const kind = nodeKinds[nodeType.value]
  if (kind === 'door' && (!car.value || !door.value)) throw new Error('车门位置必须填现场已核实的车厢与车门号，未知请勿新增门节点')
  const n: StationNodeRow = { label: nodeLabel.value.trim(), level: Number(level.value), kind, knowledge: nodeUnknown.value ? 'unknown' : 'confirmed' }
  if (kind === 'door' || kind === 'facility') Object.assign(n, { line: lineName.value, direction: directionName.value })
  if (kind === 'door') Object.assign(n, { car: Number(car.value), door: Number(door.value) })
  const at = patch.value.nodes.findIndex(x => x.label === n.label)
  if (at >= 0) patch.value.nodes[at] = n; else patch.value.nodes.push(n)
  nodeLabel.value = ''; message.value = '节点已加入草稿；再添加通路将它们连接起来。'
}) }
function addPath() { handle(() => {
  if (metres.value.trim() === '' || seconds.value.trim() === '') throw new Error('距离与耗时必须填写测量值；未知不能按 0 米处理')
  const row: StationPathRow = { from: allLabels.value[fromIndex.value], to: allLabels.value[toIndex.value], kind: pathKinds[pathType.value], metres: Number(metres.value), seconds: Number(seconds.value), stairCount: pathType.value === 1 ? Number(stairCount.value) : 0, wheelchair: ['unknown', 'confirmed', 'blocked'][wheelchairIndex.value] as StationPathRow['wheelchair'], bidirectional: bidirectional.value, knowledge: pathUnknown.value ? 'unknown' : 'confirmed' }
  if (!row.from || !row.to || row.from === row.to) throw new Error('请选择两个不同节点')
  if (row.kind === 'stairs' && (!Number.isInteger(row.stairCount) || row.stairCount <= 0)) throw new Error('普通楼梯需要填写正整数级数')
  if (!Number.isFinite(row.metres) || row.metres < 0 || !Number.isFinite(row.seconds) || row.seconds <= 0) throw new Error('距离须为非负数，耗时须大于 0')
  patch.value.paths.push(row); message.value = '通路已加入草稿。单向通路按“起点 → 终点”通行。'
}) }
function addManual() { handle(() => {
  if (!manualName.value.trim()) throw new Error('请为人工对照填写简短名称')
  const positions = parsePositions(manualPositions.value)
  if (!positions.length) throw new Error('至少填写一个已核实的车厢:车门')
  const target = availableServices.value[targetIndex.value]
  patch.value.manualRecommendations.push({ label: manualName.value.trim(), line: lineName.value, direction: directionName.value, purpose: manualPurpose.value ? 'transfer' : 'exit', targetLine: manualPurpose.value ? props.dataset.lines.find(l => l.id === target.lineId)?.name : undefined, targetDirection: manualPurpose.value ? target.direction : undefined, positions, note: manualNote.value })
  message.value = '对照已保存到草稿。算法只根据通路计算，不直接采用对照推荐。'
}) }
function exportCsv() { handle(() => { csv.value = stationPatchToCsv(patch.value); active.value = 'csv'; message.value = '可复制 CSV 保存为 UTF-8 .csv，用 Excel/WPS 填写后粘贴导入；下方也可直接填写表单。' }) }
function copyCsv() { uni.setClipboardData({ data: csv.value, success: () => { message.value = 'CSV 已复制，请保存本地备份。' } }) }
function importCsv() { handle(() => {
  const imported = parseStationCsv(csv.value)
  if (imported.station !== stationName.value) throw new Error(`文件属于${imported.station}，请先在顶部选择该站。切站会清空当前草稿，请先备份。`)
  patch.value = imported; message.value = 'CSV 已载入草稿；请检查来源与记录，然后校验合并。'
}) }
function merge() { handle(() => {
  completeSource()
  const result = mergeStationPatch(props.dataset, patch.value)
  if (!result.data) throw new Error(result.errors.join('\n'))
  // The parent closes this editor only after durable storage succeeds. Keep the
  // complete draft for retry/export when storage is unavailable or full.
  emit('import', result.data); message.value = '校验已通过；只有本机保存成功后才会返回路线页。'
}) }
async function loadExample() {
  const index = props.dataset.stations.findIndex(s => s.name === singleStationExample.station)
  if (props.dataset.provenance.kind !== 'demo' || index < 0) { error.value = '填写示例仅在独立演示线网提供，请返回并切换到演示数据。真实站点不套用示例。'; return }
  stationIndex.value = index
  // Let the station watcher clear the old draft first.
  await nextTick()
  patch.value = JSON.parse(JSON.stringify(singleStationExample)); csv.value = stationPatchToCsv(patch.value); active.value = 'csv'; error.value = ''; message.value = '已载入“缺测站”合成填写示例，可先导出再粘贴导入。仅用于测试，不是真实福州设施。'
}
</script>

<template>
  <view class="station-editor">
    <view class="editor-top"><view><text class="eyebrow">个人资料维护</text><text class="editor-title">逐站补充站内资料</text></view><button class="small-button" @click="emit('close')">返回</button></view>
    <view class="editor-notice">只填写已核实资料。门数与编号规则未提供，不会自动生成车门。缺失区域继续显示“精细指引待补充”。</view>
    <button v-if="dataset.provenance.kind === 'demo'" class="action-button secondary" @click="loadExample">载入独立演示站填写示例</button>
    <view class="form-card">
      <text class="card-title">1 · 选择车站与方向</text>
      <text class="field-label">车站（切换会清空未合并草稿，请先复制备份）</text><picker :range="dataset.stations.map(s => s.name)" :value="stationIndex" @change="stationIndex = choose($event)"><view class="select-value">{{ stationName }} ▾</view></picker>
      <text class="field-label">线路</text><picker :range="lines.map(l => l.name)" :value="lineIndex" @change="lineIndex = choose($event)"><view class="select-value">{{ lineName }} ▾</view></picker>
      <text class="field-label">运行方向 / 站台</text><picker :range="directions.map(s => '往' + s.direction)" :value="directionIndex" @change="directionIndex = choose($event)"><view class="select-value">往{{ directionName }} ▾</view></picker>
      <text class="field-label">来源类型</text><picker :range="sourceTypes" :value="sourceIndex" @change="patch.provenance.kind = sourceKinds[choose($event)]"><view class="select-value">{{ sourceTypes[sourceIndex] }} ▾</view></picker>
      <text class="field-label">资料来源 / 核实人（必填）</text><input v-model="patch.provenance.source" class="text-field" placeholder="如：本人现场测量，记录本第 3 页" />
      <text class="field-label">核实日期（必填）</text><picker mode="date" :value="patch.provenance.recordedAt" @change="patch.provenance.recordedAt = $event.detail.value"><view class="select-value">{{ patch.provenance.recordedAt || '选择日期' }} ▾</view></picker>
    </view>
    <view class="entry-tabs"><button v-for="tab in ([['node','节点'],['path','通路'],['manual','对照'],['csv','表格']] as const)" :key="tab[0]" :class="{ selected: active === tab[0] }" @click="active = tab[0]">{{ tab[1] }}</button></view>
    <view v-if="active === 'node'" class="form-card">
      <text class="card-title">2 · 添加位置节点</text><text class="field-help">先添加设施的两端位置，再在“通路”中连接。例如“电梯站台口”和“电梯站厅口”；名称可自行取，不用维护 ID。</text>
      <text class="field-label">节点类别</text><picker :range="nodeTypes" :value="nodeType" @change="nodeType = choose($event)"><view class="select-value">{{ nodeTypes[nodeType] }} ▾</view></picker>
      <text class="field-label">简短名称（同站内唯一，同名再次录入会更新）</text><input v-model="nodeLabel" class="text-field" placeholder="如：北侧电梯站台口" />
      <text class="field-label">楼层（地面 0，地下 B1 填 -1，B2 填 -2）</text><input v-model="level" class="text-field" type="text" placeholder="填写楼层" />
      <view v-if="nodeType === 2"><text class="field-label">已核实的车厢号</text><input v-model="car" class="text-field" type="number" placeholder="按本方向现场编号填写" /><text class="field-label">已核实的车门号</text><input v-model="door" class="text-field" type="number" placeholder="不推定每节车厢门数" /><text class="field-help">该门归属于 {{ lineName }} 往{{ directionName }}。尚未确认编号时不要填写门节点，可先录设施与通路。</text></view>
      <view class="switch-row"><text>位置尚未确认（不参与推荐）</text><switch :checked="nodeUnknown" @change="nodeUnknown = checked($event)" /></view>
      <button class="action-button" @click="addNode">加入节点草稿</button>
    </view>
    <view v-if="active === 'path'" class="form-card">
      <text class="card-title">3 · 连接通路与设施</text><text class="field-help">设施位置通过连接两端节点表达。扶梯须按实际方向填写；无障碍通路还需单独确认轮椅通行。</text>
      <text class="field-label">起点位置</text><picker :range="allLabels" :value="fromIndex" @change="fromIndex = choose($event)"><view class="select-value">{{ allLabels[fromIndex] || '请先添加节点' }} ▾</view></picker>
      <text class="field-label">终点位置</text><picker :range="allLabels" :value="toIndex" @change="toIndex = choose($event)"><view class="select-value">{{ allLabels[toIndex] || '请先添加节点' }} ▾</view></picker>
      <text class="field-label">通行方式</text><picker :range="pathTypes" :value="pathType" @change="pathType = choose($event)"><view class="select-value">{{ pathTypes[pathType] }} ▾</view></picker>
      <text class="field-label">实际步行距离（米，电梯/扶梯仅填接驳步行）</text><input v-model="metres" class="text-field" type="digit" placeholder="未知请暂不提交通路" />
      <text class="field-label">总通行耗时（秒，包含设施运行）</text><input v-model="seconds" class="text-field" type="digit" placeholder="填写现场测量值" />
      <view v-if="pathType === 1"><text class="field-label">普通楼梯级数</text><input v-model="stairCount" class="text-field" type="number" placeholder="填写级数" /></view>
      <text class="field-label">轮椅通行</text><picker :range="wheelchairLabels" :value="wheelchairIndex" @change="wheelchairIndex = choose($event)"><view class="select-value">{{ wheelchairLabels[wheelchairIndex] }} ▾</view></picker>
      <view class="switch-row"><text>双向通行（关闭即仅起点 → 终点）</text><switch :checked="bidirectional" @change="bidirectional = checked($event)" /></view>
      <view class="switch-row"><text>通路尚未确认（不参与推荐）</text><switch :checked="pathUnknown" @change="pathUnknown = checked($event)" /></view>
      <button class="action-button" @click="addPath">加入通路草稿</button>
    </view>
    <view v-if="active === 'manual'" class="form-card">
      <text class="card-title">人工核实推荐 · 仅供对照</text><text class="field-help">保存现场建议，方便对照算法。不会直接附加到路线，也不能代替设施和通路录入。</text>
      <text class="field-label">对照名称</text><input v-model="manualName" class="text-field" placeholder="如：北侧换乘口核实记录" />
      <text class="field-label">用途</text><picker :range="['出站 / 离开站台','换乘']" :value="manualPurpose" @change="manualPurpose = choose($event)"><view class="select-value">{{ manualPurpose ? '换乘' : '出站 / 离开站台' }} ▾</view></picker>
      <view v-if="manualPurpose"><text class="field-label">换乘目标方向</text><picker :range="targetOptions" :value="targetIndex" @change="targetIndex = choose($event)"><view class="select-value">{{ targetOptions[targetIndex] }} ▾</view></picker></view>
      <text class="field-label">等价位置（车厢:车门，多组用分号分隔）</text><input v-model="manualPositions" class="text-field" placeholder="格式示例 2:1;2:2，须填现场核实值" />
      <text class="field-label">核实说明</text><textarea v-model="manualNote" class="text-area" placeholder="记录依据及与算法不同的原因" />
      <button class="action-button" @click="addManual">加入对照草稿</button>
    </view>
    <view v-if="active === 'csv'" class="form-card">
      <text class="card-title">本地表格与草稿备份</text><text class="field-help">点击“生成 CSV”可导出当前草稿；空草稿即为本站空模板。复制保存为 UTF-8 CSV 后可用 Excel/WPS 编辑，填写规则见 docs/station-entry.md。导入不会自动合并。</text>
      <button class="action-button secondary" @click="exportCsv">生成本站 CSV / 导出草稿</button>
      <textarea v-model="csv" class="text-area csv-area" :maxlength="-1" placeholder="粘贴单站 CSV 内容" />
      <button class="action-button secondary" @click="copyCsv">复制 CSV</button><button class="action-button secondary" @click="importCsv">将 CSV 载入草稿</button>
    </view>
    <view class="form-card">
      <view class="draft-head"><text class="card-title">待合并草稿 · {{ pendingCount }} 条</text><button class="small-button" @click="exportCsv">导出备份</button></view>
      <text v-if="!pendingCount" class="field-help">可以只录一个设施或一个方向，逐步补全。</text>
      <view v-for="(n, i) in patch.nodes" :key="'n' + i" class="draft-row"><text>{{ n.label }} · 楼层 {{ n.level }}{{ n.kind === 'door' ? ` · ${n.car}车${n.door}门` : '' }}</text><button class="remove-button" @click="patch.nodes.splice(i, 1)">移除</button></view>
      <view v-for="(p, i) in patch.paths" :key="'p' + i" class="draft-row"><text>{{ p.from }} → {{ p.to }} · {{ p.metres }}米</text><button class="remove-button" @click="patch.paths.splice(i, 1)">移除</button></view>
      <view v-for="(r, i) in patch.manualRecommendations" :key="'r' + i" class="draft-row"><text>人工对照：{{ r.label }}</text><button class="remove-button" @click="patch.manualRecommendations.splice(i, 1)">移除</button></view>
      <text v-if="error || saveError" class="error-message">{{ error || saveError }}</text><text v-if="message && !saveError" class="success-message">{{ message }}</text>
      <button class="action-button merge-button" @click="merge">校验并合并到当前本地数据</button>
      <text class="field-help">校验失败不会修改原数据。导入后仍标记部分资料；不会自动声称完整无障碍。返回后重新计算路线可查看更新。</text>
    </view>
  </view>
</template>

<style scoped>
.station-editor { color:#142e2b; font-size:16px; padding:16px 12px 32px; max-width:600px; margin:auto; background:#f2f6f4; overflow-wrap:anywhere; }
.editor-top,.draft-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }.editor-top { margin-bottom:16px; }.eyebrow,.editor-title,.card-title,.field-label,.field-help,.error-message,.success-message { display:block; }.eyebrow { font-size:14px; color:#46645e; margin-bottom:5px; }.editor-title { font-size:23px; font-weight:700; }.editor-notice { padding:14px; line-height:1.6; background:#fff2d6; border-radius:12px; margin-bottom:12px; color:#64460c; }.form-card { background:#fff; border:1px solid #d6e2dd; border-radius:14px; padding:16px; margin-bottom:14px; }.card-title { font-size:18px; font-weight:700; line-height:1.5; }.field-label { margin:16px 0 7px; font-weight:600; font-size:15px; line-height:1.5; }.field-help { font-size:14px; line-height:1.6; color:#426259; margin-top:10px; }.select-value,.text-field { box-sizing:border-box; min-height:50px; border:1px solid #9eb8ac; border-radius:9px; padding:12px; font-size:16px; line-height:24px; background:#fff; }.text-field { height:50px; width:100%; }.text-area { box-sizing:border-box; width:100%; height:104px; border:1px solid #9eb8ac; border-radius:9px; padding:12px; font-size:16px; margin-top:10px; }.csv-area { height:220px; }.entry-tabs { display:grid; grid-template-columns:repeat(4,1fr); gap:7px; margin-bottom:14px; }.entry-tabs button { width:100%; margin:0; padding:0 4px; min-height:48px; line-height:48px; background:#fff; font-size:16px; color:#254f42; border:1px solid #afc6bc; }.entry-tabs .selected { background:#13694d; color:#fff; }.action-button { min-height:50px; line-height:24px; padding:13px 10px; margin-top:15px; font-size:16px; font-weight:700; color:#fff; background:#116a4c; border-radius:10px; }.action-button.secondary { color:#17503c; background:#eaf3ed; }.small-button { flex-shrink:0; min-width:64px; min-height:48px; line-height:24px; padding:12px 10px; margin:0; font-size:15px; color:#215541; background:#e8f2eb; }.switch-row { min-height:56px; display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px; font-size:15px; line-height:1.5; }.switch-row switch { flex-shrink:0; }.draft-row { display:flex; align-items:center; gap:8px; justify-content:space-between; border-bottom:1px solid #deebe4; padding:9px 0; line-height:1.6; }.remove-button { margin:0; padding:0 8px; min-width:58px; min-height:48px; line-height:48px; flex-shrink:0; font-size:14px; color:#88412f; background:#fbefe9; }.error-message,.success-message { white-space:pre-wrap; padding:12px; margin-top:12px; line-height:1.6; border-radius:9px; }.error-message { color:#9d241c; background:#fff0ec; }.success-message { color:#18533b; background:#eaf8ed; }.merge-button { width:100%; }button::after { border:none; }
</style>
