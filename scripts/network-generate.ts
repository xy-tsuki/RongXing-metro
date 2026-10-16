/** Auditable, operating-only transcription. Regenerate with: npx tsx scripts/network-generate.ts */
import { writeFileSync } from 'node:fs'

const checkedAt = '2026-10-16'
const attachment = '用户附件：01.公开版-福州地铁线路3.0-a运营版（至2026年08月）.jpg'
export const networkLines = [
  { code: 'l1', name: '1号线', color: '#D92336', cars: 6, names: '象峰|秀山|罗汉山|福州火车站|斗门|树兜|屏山|东街口|南门兜|茶亭|达道|上藤|三叉街|白湖亭|葫芦阵|黄山|排下|城门|三角埕|胪雷|福州火车南站|安平|梁厝|下洋|三江口' },
  { code: 'l2', name: '2号线', color: '#158253', cars: 6, names: '苏洋|沙堤|上街|金屿|福州大学|董屿·福建师大|厚庭|桔园洲|洪湾|金山|金祥|祥坂|宁化|西洋|南门兜|水部|紫阳|五里亭|前屿|上洋|鼓山|洋里' },
  { code: 'l4', name: '4号线', color: '#D78B19', cars: 6, names: '半洲|建新|洪塘|金牛山|凤凰池|陆庄|西门|东街口|省立医院|东门|三角池|竹屿|横屿|后屿|前屿|光明港|鳌峰洲|花海公园|会展中心|林浦|城门|螺洲温泉|帝封江' },
  { code: 'l5', name: '5号线', color: '#974781', cars: 6, names: '荆溪厚屿|农林大学|洪塘|阵坂|马榕|金山|凤岗里|浦上大道|霞镜|东岭|台屿|盘屿|吴山|盖山竹榄|义序|帝封江|螺洲古镇|前锦|龙江|福州火车南站' },
  // 莲花、壶井暂未开放，不是上下客站；万寿以东建设段不进入运营路网。
  { code: 'l6', name: '6号线', color: '#0875B4', cars: 4, names: '潘墩|林浦|樟岚|梁厝|下洋|营前|航城|郑和|十洋|吴航|鹤上|沙京|下吴|万寿' },
  // 三叉街（滨海快线）不与1号线三叉街合站：须出站换乘。
  { code: 'f1', name: '滨海快线（F1线）', color: '#159EAC', cars: 4, names: '福州火车站|东门|闽都|南公园|三叉街（滨海快线）|帝封江|祥谦|首占|大数据|滨海中央商务区|机场|文岭' },
] as const

const sources = [
  { id: 'post-map-operating-notice', kind: 'official', title: '免费！延时！福州地铁重要提醒！', url: 'https://www.fzcl.gov.cn/xjwz/wsbs/bmfwcx/jt/202609/t20260930_5378219.htm', publishedAt: '2026-09-30', checkedAt, claims: ['长乐政府转载福州地铁国庆运营公告仍列出1、2、4、5、6号线及滨海快线，交叉核对附件之后的运营线路集合；不据此推断各站开放状态，不导入假期时刻或优惠'] },
  { id: 'attachment-202608', kind: 'user', title: attachment, url: null, publishedAt: '2026-08', checkedAt, claims: ['六条线路的站名、站序、换乘符号和未开放站标记；不是官方出版物'], method: '原始4375×3125图片分区放大转录' },
  { id: 'operating-lines', kind: 'official', title: '福州再送“出行福包” 邀全国游客春节畅游榕城', url: 'https://www.fuzhou.gov.cn/zwgk/gzdt/tpxw/202602/t20260202_5279764.htm', publishedAt: '2026-02-02', checkedAt, claims: ['运营线路为1、2、4、5、6号线及滨海快线'] },
  { id: 'l4-opening', kind: 'official', title: '福州地铁4号线后通段今日开通运营 双线闭环串联四城区', url: 'https://zx.fuzhou.gov.cn/zz/csfz/tpxw/202512/t20251210_5255685.htm', publishedAt: '2025-12-10', checkedAt, claims: ['半洲、建新、洪塘、金牛山后通段已开通，洪塘可与5号线换乘'] },
  { id: 'f1-opening', kind: 'official', title: '今天，滨海快线开通啦！', url: 'https://www.fuzhou.gov.cn/zwgk/gzdt/rcyw/202509/t20250929_5084683.htm', publishedAt: '2025-09-29', checkedAt, claims: ['滨海快线于2025-09-29载客运营，列车为四节车厢'] },
  { id: 'f1-interchange', kind: 'official', title: '福州滨海快线这样换乘', url: 'https://www.fuzhou.gov.cn/zwgk/gzdt/rcyw/202509/t20250918_5079719.htm', publishedAt: '2025-09-18', checkedAt, claims: ['福州火车站与1号线、东门与4号线、帝封江与4/5号线可站内换乘；三叉街两站及闽都/水部须出站换乘；滨海西暂缓开放'] },
  { id: 'f1-current-service', kind: 'official', title: '明起福州地铁运营时间全面提前', url: 'https://www.fuzhou.gov.cn/zwgk/gzdt/rcyw/202602/t20260201_5279714.htm', publishedAt: '2026-02-01', checkedAt, claims: ['普通列车停靠沿线所有运营车站；大站/直达快车停站不同，不可用全停交路代替快车'] },
  { id: 'f1-reserves', kind: 'official', title: '滨海快线线路示意图（发改委附图）', url: 'https://fgw.fuzhou.gov.cn/fgwzwgk/tzgg/202508/P020250801646577570761.pdf', publishedAt: '2025-08-01', checkedAt, claims: ['盖山、莲花山为预留；工程15站不等于15站全部运营'] },
  { id: 'l6-deferred', kind: 'official', title: '福州地铁6号线开通运营', url: 'https://jtyst.fujian.gov.cn/zwgk/jtyw/mtsy/202209/t20220901_5985680.htm', publishedAt: '2022-09-01', checkedAt, claims: ['莲花、壶井暂缓开通；梁厝、下洋与1号线换乘，林浦与4号线换乘；附件2026-08仍为灰名'] },
  { id: 'extension-progress', kind: 'official', title: '跑出加速度 福州这两条在建地铁又有新进展', url: 'https://zjj.fuzhou.gov.cn/zwgk/dtxx/zwgk/202607/t20260720_5348279.htm', publishedAt: '2026-07-20', checkedAt, claims: ['2号线东延、6号线东调仍为建设阶段，建成/调试目标不能作为载客开通证明'] },
  { id: 'post-map-extension-progress', kind: 'official', title: '市住建局优质服务促进地铁建设提质增效', url: 'https://zjj.fuzhou.gov.cn/zwgk/dtxx/zwgk/202609/t20260922_5374620.htm', publishedAt: '2026-09-22', checkedAt, claims: ['附件之后的新官方进展仍报告6号线东调、2号线东延一期建设投资（截至8月底），未宣布载客开通'] },
  { id: 'post-map-road', kind: 'official', title: '长乐这条新路竣工！将打通滨海快线滨海西站便民通道', url: 'https://www.fzcl.gov.cn/xjwz/zwgk/zfxxgkzdgz/zdjsxm/jsqk/202609/t20260908_5369364.htm', publishedAt: '2026-09-08', checkedAt, claims: ['检索摘要为车站周边道路竣工，不是车站载客公告'], retrieval: '官方搜索摘要可读，正文抓取失败；不用于证明车站已开放' },
  { id: 'formation-owner', kind: 'user', title: '本次用户确定的编组数据', url: null, publishedAt: checkedAt, checkedAt, claims: ['6号线、F1线4节，其余运营线路6节；每节车门数量、编号和纵向位置均未提供'] },
]
const stationId = (name: string) => `fz-${name === '三叉街（滨海快线）' ? '三叉街-滨海快线' : name}`
const names = [...new Set(networkLines.flatMap(line => line.names.split('|')))]
const dataset = {
  schemaVersion: '1.0', version: 'fuzhou-operating-2026-10-16.1', city: { id: 'fuzhou', name: '福州' },
  description: '真实运营线网及已知编组；站序转录自用户2026年8月附件并以官方开通/换乘资料核对。站内设施、楼层、车门编号和运行耗时未录入，精细指引待补充。F1仅提供普通列车全停基础路线，不代表快车停站或时刻表。',
  provenance: { kind: 'official', source: '用户2026-08附件＋福州市政府、福建省交通运输厅等开通/换乘资料；字段证据见sources及docs/network-sources.md；编组依用户提供', recordedAt: checkedAt },
  sources,
  coverage: { checkedAt, attachmentDate: '2026-08', topology: 'operating-only', indoor: 'missing', doorNumbering: 'unknown', rideTimes: 'unknown', accessibility: '按用户明确的福州电梯全覆盖前提；具体连续通路尚未核实', limitations: ['截至核对日未检索到2号线东延、6号线东调、莲花、壶井、滨海西的新载客开通公告；保留已确认运营快照，不把搜索无结果当作绝对未开通证明。', 'F1只计算普通列车基础乘车路线；实际班次及快车停站以现场信息为准。'] },
  stations: names.map(name => ({ id: stationId(name), name, concourseNodeIds: [], indoorData: 'missing', sourceIds: ['attachment-202608'] })),
  lines: networkLines.map(({ code, name, color }) => ({ id: `fz-${code}`, name, color, status: 'operating', sourceIds: ['attachment-202608', 'operating-lines'] })),
  formations: networkLines.map(({ code, cars }) => ({ id: `fz-${code}-train`, cars, positions: [], doorsKnown: false, numberingStatus: 'unknown', provenance: { kind: 'user', source: '本次用户明确车辆编组；门数及编号未提供', recordedAt: checkedAt }, sourceIds: ['formation-owner'] })),
  platforms: [],
  services: networkLines.flatMap(line => {
    const stations = line.names.split('|')
    return [stations, [...stations].reverse()].map((ordered, direction) => ({
      id: `fz-${line.code}-${direction ? 'reverse' : 'forward'}`, lineId: `fz-${line.code}`, direction: ordered[ordered.length - 1], formationId: `fz-${line.code}-train`,
      servicePattern: 'all-stop', serviceLabel: line.code === 'f1' ? '普通列车（非快车）' : '普通列车', sourceIds: line.code === 'f1' ? ['attachment-202608', 'f1-current-service'] : ['attachment-202608'],
      stops: ordered.map(name => ({ stationId: stationId(name), platformId: null, minutesFromPrevious: null })),
    }))
  }),
  walkNodes: [], walkEdges: [],
  externalTransfers: [
    { id: 'fz-external-sanchajie', fromStationId: stationId('三叉街'), toStationId: stationId('三叉街（滨海快线）'), bidirectional: true, walkingMetres: null, minutes: null, wheelchair: 'unknown', provenance: { kind: 'official', source: 'https://www.fuzhou.gov.cn/zwgk/gzdt/rcyw/202509/t20250918_5079719.htm', recordedAt: checkedAt }, sourceIds: ['f1-interchange'], note: '需出站经地面重新进站，具体通路及距离未录入，不能视为站内换乘或完整无障碍通路。' },
    { id: 'fz-external-shuibu-mindu', fromStationId: stationId('水部'), toStationId: stationId('闽都'), bidirectional: true, walkingMetres: null, minutes: null, wheelchair: 'unknown', provenance: { kind: 'official', source: 'https://www.fuzhou.gov.cn/zwgk/gzdt/rcyw/202509/t20250918_5079719.htm', recordedAt: checkedAt }, sourceIds: ['f1-interchange'], note: '需出站换乘，具体通路及距离未录入，不能视为站内换乘或完整无障碍通路。' },
  ],
  excluded: [
    { lineId: 'fz-l6', names: ['莲花', '壶井'], reason: '暂缓开放', sourceIds: ['attachment-202608', 'l6-deferred'] },
    { lineId: 'fz-f1', names: ['盖山', '莲花山'], reason: '预留', sourceIds: ['f1-reserves'] },
    { lineId: 'fz-f1', names: ['滨海西'], reason: '暂缓开放；道路竣工不等于车站开放', sourceIds: ['attachment-202608', 'f1-interchange', 'post-map-road'] },
    { lineId: 'fz-l2', name: '2号线东延线一期', reason: '建设阶段，未取得载客开通公告', sourceIds: ['extension-progress', 'post-map-extension-progress'] },
    { lineId: 'fz-l6', name: '6号线东调段', reason: '建设阶段，未取得载客开通公告', sourceIds: ['extension-progress', 'post-map-extension-progress'] },
  ],
}
writeFileSync('src/data/fuzhou-network.json', JSON.stringify(dataset, null, 2) + '\n')
console.log(`Generated ${names.length} stations, ${networkLines.length} lines, ${dataset.services.length} directional services; no invented indoor/door/time data.`)
for (const line of networkLines) console.log(`${line.name}: ${line.names.split('|').length} stops, ${line.cars} cars`)
