import type { DoorCombination, DoorPosition, ExternalTransfer, JourneyLeg, JourneyRoute, MetroDataset, PlanRequest, PlanResult, RouteMode, Service, WalkEdge, WalkPath } from './types'
import { validateDataset } from './validation'

type Metric = [number, number, number]
interface Ride { service: Service; start: number; end: number; minutes: number | null; connection?: ExternalTransfer }
interface Choice { positions: DoorPosition[]; paths: WalkPath[]; metric: Metric }
const MAX_LEGS = 4, MAX_CANDIDATES = 500, MAX_EXPANSIONS = 20_000, MAX_EQUAL_CHOICES = 256
const EPS = 1e-6
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const diff = (a[i] ?? 0) - (b[i] ?? 0); if (Math.abs(diff) > EPS) return diff }
  return 0
}
function metric(path: WalkPath, mode: RouteMode): Metric {
  return mode === 'few-stairs' ? [path.stairCount, path.metres, path.minutes * 60] : [path.metres, path.stairCount, path.minutes * 60]
}
function add(a: Metric, b: Metric): Metric { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }

/** Dijkstra on the directed indoor graph. No vertical walk edge can pass validation. */
export function findWalkPath(data: MetroDataset, from: string[], to: string[], mode: RouteMode): WalkPath | null {
  const nodes = new Map(data.walkNodes.map(x => [x.id, x]))
  const adjacency = new Map<string, { edge: WalkEdge; next: string }[]>()
  const addEdge = (fromId: string, next: string, edge: WalkEdge) => { const list = adjacency.get(fromId) ?? []; list.push({ edge, next }); adjacency.set(fromId, list) }
  for (const e of data.walkEdges) {
    if (e.knowledge !== 'confirmed' || nodes.get(e.from)?.knowledge !== 'confirmed' || nodes.get(e.to)?.knowledge !== 'confirmed') continue
    if (mode === 'elevator' && (e.kind === 'stairs' || e.kind === 'escalator' || e.wheelchair !== 'confirmed')) continue
    addEdge(e.from, e.to, e)
    if (e.bidirectional) addEdge(e.to, e.from, e)
  }
  const dist = new Map<string, Metric>(), previous = new Map<string, { prev: string; edge: WalkEdge }>(), done = new Set<string>()
  for (const id of from) if (nodes.get(id)?.knowledge === 'confirmed') dist.set(id, [0, 0, 0])
  let target: string | undefined
  while (true) {
    let current: string | undefined, best: Metric | undefined
    for (const [id, cost] of dist) if (!done.has(id) && (!best || compare(cost, best) < 0)) { current = id; best = cost }
    if (!current || !best) break
    if (to.includes(current)) { target = current; break }
    done.add(current)
    for (const { edge, next } of adjacency.get(current) ?? []) {
      const step: WalkPath = { nodes: [], edges: [], metres: edge.metres, minutes: edge.seconds / 60, stairCount: edge.stairCount, instructions: [] }
      const score = add(best, metric(step, mode))
      if (!dist.has(next) || compare(score, dist.get(next)!) < 0) { dist.set(next, score); previous.set(next, { prev: current, edge }) }
    }
  }
  if (!target) return null
  const pathNodes = [target], pathEdges: WalkEdge[] = []
  let current = target
  while (previous.has(current)) { const p = previous.get(current)!; pathEdges.unshift(p.edge); pathNodes.unshift(p.prev); current = p.prev }
  const labels: Record<WalkEdge['kind'], string> = { walk: '步行', stairs: '走楼梯', escalator: '乘扶梯', lift: '乘电梯' }
  const floorLabel = (level: number) => level === 0 ? '地面层' : level < 0 ? `地下${Math.abs(level)}层` : `地上${level}层`
  return {
    nodes: pathNodes, edges: pathEdges,
    metres: pathEdges.reduce((s, e) => s + e.metres, 0), minutes: pathEdges.reduce((s, e) => s + e.seconds, 0) / 60,
    stairCount: pathEdges.reduce((s, e) => s + e.stairCount, 0),
    instructions: pathEdges.map((e, index) => {
      const from = nodes.get(pathNodes[index])!, to = nodes.get(pathNodes[index + 1])!
      return from.level === to.level
        ? `${labels[e.kind]}${Math.round(e.metres)}米，前往${to.label}`
        : `${labels[e.kind]}${to.level < from.level ? '下行' : '上行'}至${floorLabel(to.level)}，前往${to.label}（${e.kind === 'lift' || e.kind === 'escalator' ? '接驳步行' : '步行'}约${Math.round(e.metres)}米）`
    }),
  }
}

function enumerateRides(data: MetroDataset, request: PlanRequest): { candidates: Ride[][]; truncated: boolean } {
  const candidates: Ride[][] = []
  let expansions = 0, truncated = false, serial = 0
  // Topology labels are safe only when there is no spatial evidence at all.
  // A shorter prefix can be inaccessible while a longer one reaches the same
  // service via a working interchange, regardless of unrelated formations.
  const topologyOnly = data.walkNodes.length === 0 && data.walkEdges.length === 0
  const maxLegs = topologyOnly ? Math.max(MAX_LEGS, Math.min(12, data.lines.length + 1)) : MAX_LEGS
  const boardings = new Map<string, { service: Service; index: number }[]>()
  for (const service of data.services) service.stops.forEach((stop, index) => {
    const list = boardings.get(stop.stationId) ?? []; list.push({ service, index }); boardings.set(stop.stationId, list)
  })
  interface State { at: string; legs: Ride[]; stops: number; order: number }
  const heap: State[] = [], labels = new Map<string, { cost: number[]; ties: number }[]>()
  const prefixCost = (s: State) => [s.legs.length, s.legs.filter(ride => !!ride.connection).length, s.stops]
  const score = (s: State) => [...prefixCost(s), s.order]
  const dominates = (a: number[], b: number[]) => a.every((value, index) => value <= b[index] + EPS)
  const push = (state: State) => {
    if (topologyOnly && state.legs.length) {
      const key = `${state.at}|${state.legs[state.legs.length - 1].service.id}`, cost = prefixCost(state), known = labels.get(key) ?? []
      const equal = known.find(label => compare(cost, label.cost) === 0)
      if (equal) { if (equal.ties >= 4) return; equal.ties++ }
      else {
        // Unknown outside walking is an independent tradeoff, never zero cost:
        // fewer train changes cannot dominate an entirely in-station prefix.
        if (known.some(label => dominates(label.cost, cost))) return
        labels.set(key, [...known.filter(label => !dominates(cost, label.cost)), { cost, ties: 1 }])
      }
    }
    heap.push(state)
    let i = heap.length - 1
    while (i > 0) { const parent = (i - 1) >> 1; if (compare(score(heap[parent]), score(heap[i])) <= 0) break; [heap[i], heap[parent]] = [heap[parent], heap[i]]; i = parent }
  }
  const pop = () => {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      while (true) { let next = i; for (const child of [i * 2 + 1, i * 2 + 2]) if (child < heap.length && compare(score(heap[child]), score(heap[next])) < 0) next = child; if (next === i) break; [heap[i], heap[next]] = [heap[next], heap[i]]; i = next }
    }
    return first
  }
  push({ at: request.from, legs: [], stops: 0, order: serial++ })
  while (heap.length) {
    if (++expansions > MAX_EXPANSIONS || candidates.length >= MAX_CANDIDATES) { truncated = true; break }
    const state = pop(), { at, legs, stops } = state
    if (topologyOnly && legs.length) {
      const cost = prefixCost(state), key = `${at}|${legs[legs.length - 1].service.id}`
      if ((labels.get(key) ?? []).some(label => dominates(label.cost, cost) && compare(label.cost, cost) !== 0)) continue
    }
    if (at === request.to) { candidates.push(legs); continue }
    if (legs.length >= maxLegs) continue
    const options = [...(boardings.get(at) ?? [])].map(b => ({ ...b, connection: undefined as ExternalTransfer | undefined }))
    if (legs.length) for (const link of data.externalTransfers ?? []) {
      if (request.mode === 'elevator' && link.wheelchair === 'blocked') continue
      const connection = link.fromStationId === at ? link : link.bidirectional && link.toStationId === at ? { ...link, fromStationId: at, toStationId: link.fromStationId } : null
      if (connection) for (const boarding of boardings.get(connection.toStationId) ?? []) options.push({ ...boarding, connection })
    }
    for (const { service, index, connection } of options) {
      // Continuing the same service is already represented by its longer ride.
      if (legs[legs.length - 1]?.service.id === service.id) continue
      let minutes: number | null = 0
      for (let end = index + 1; end < service.stops.length; end++) {
        const stop = service.stops[end]
        minutes = minutes === null || stop.minutesFromPrevious == null ? null : minutes + stop.minutesFromPrevious
        const ride = { service, start: index, end, minutes, connection }
        // Passing through the same station on another train is legitimate,
        // especially when its elevators cannot be used. Bounded leg/search
        // counts provide termination without station-visited pruning.
        if (stop.stationId === request.to || (boardings.get(stop.stationId) ?? []).some(b => b.service.id !== service.id) || (data.externalTransfers ?? []).some(link => link.fromStationId === stop.stationId || link.bidirectional && link.toStationId === stop.stationId)) push({ at: stop.stationId, legs: [...legs, ride], stops: stops + end - index, order: serial++ })
      }
    }
  }
  return { candidates, truncated }
}

function optimizeDoors(data: MetroDataset, rides: Ride[], mode: RouteMode, cache: Map<string, WalkPath | null>): { choices: Choice[]; truncated: boolean } {
  if (rides.some(r => r.connection)) return { choices: [], truncated: false }
  const platforms = new Map(data.platforms.map(p => [p.id, p])), formations = new Map(data.formations.map(f => [f.id, f]))
  const stations = new Map(data.stations.map(s => [s.id, s]))
  const walk = (from: string[], to: string[]) => {
    const key = `${from.join(',')}|${to.join(',')}`
    if (!cache.has(key)) cache.set(key, findWalkPath(data, from, to, mode))
    return cache.get(key)!
  }
  let states = new Map<string, Choice[]>(), truncated = false
  rides.forEach((ride, legIndex) => {
    const board = platforms.get(ride.service.stops[ride.start].platformId ?? '')
    const nextStates = new Map<string, Choice[]>()
    if (!board) { states = nextStates; return }
    for (const position of formations.get(ride.service.formationId)!.positions) {
      if (formations.get(ride.service.formationId)!.numberingStatus === 'unknown' && position.numberingConfirmed !== true) continue
      if (!board.doorNodes[position.id]) continue
      const candidates: Choice[] = []
      if (legIndex === 0) {
        const path = walk(stations.get(ride.service.stops[ride.start].stationId)!.concourseNodeIds, [board.doorNodes[position.id]])
        if (path) candidates.push({ positions: [position], paths: [path], metric: metric(path, mode) })
      } else {
        const previousRide = rides[legIndex - 1]
        const alight = platforms.get(previousRide.service.stops[previousRide.end].platformId ?? '')
        if (!alight) continue
        for (const choices of states.values()) for (const choice of choices) {
          const previousPosition = choice.positions[choice.positions.length - 1]
          if (!alight.doorNodes[previousPosition.id]) continue
          const path = walk([alight.doorNodes[previousPosition.id]], [board.doorNodes[position.id]])
          if (path) candidates.push({ positions: [...choice.positions, position], paths: [...choice.paths, path], metric: add(choice.metric, metric(path, mode)) })
        }
      }
      candidates.sort((a, b) => compare(a.metric, b.metric))
      const equal = candidates.filter(c => compare(c.metric, candidates[0].metric) === 0)
      if (equal.length > MAX_EQUAL_CHOICES) truncated = true
      if (equal.length) nextStates.set(position.id, equal.slice(0, MAX_EQUAL_CHOICES))
    }
    states = nextStates
  })
  const last = rides[rides.length - 1], alight = platforms.get(last.service.stops[last.end].platformId ?? '')
  const final: Choice[] = []
  if (!alight) return { choices: [], truncated }
  for (const choices of states.values()) for (const choice of choices) {
    if (!alight.doorNodes[choice.positions[choice.positions.length - 1].id]) continue
    const path = walk([alight.doorNodes[choice.positions[choice.positions.length - 1].id]], stations.get(last.service.stops[last.end].stationId)!.concourseNodeIds)
    if (path) final.push({ positions: choice.positions, paths: [...choice.paths, path], metric: add(choice.metric, metric(path, mode)) })
  }
  final.sort((a, b) => compare(a.metric, b.metric))
  const equal = final.filter(c => compare(c.metric, final[0].metric) === 0)
  if (equal.length > MAX_EQUAL_CHOICES) truncated = true
  return { choices: equal.slice(0, MAX_EQUAL_CHOICES), truncated }
}

function makeRoute(data: MetroDataset, rides: Ride[], optimized: { choices: Choice[]; truncated: boolean }): JourneyRoute {
  const stations = new Map(data.stations.map(x => [x.id, x])), lines = new Map(data.lines.map(x => [x.id, x]))
  const recommendation = (p: DoorPosition) => ({ car: p.car, door: p.door, positionId: p.id })
  const combos: DoorCombination[] = optimized.choices.map(c => ({ positions: c.positions.map(recommendation), originPath: c.paths[0], transferPaths: c.paths.slice(1, -1), destinationPath: c.paths[c.paths.length - 1] }))
  const primary = combos[0]
  const completeDoors = rides.every(r => { const f = data.formations.find(f => f.id === r.service.formationId)!; return f.doorsKnown !== false && f.numberingStatus !== 'unknown' })
  const legs = rides.map((r, index) => {
    const line = lines.get(r.service.lineId)!, fromStationId = r.service.stops[r.start].stationId, toStationId = r.service.stops[r.end].stationId
    const unique = new Map(combos.map(c => [c.positions[index].positionId, c.positions[index]]))
    return { serviceId: r.service.id, lineId: line.id, lineName: line.name, lineColor: line.color, direction: r.service.direction, fromStationId, fromStationName: stations.get(fromStationId)!.name, toStationId, toStationName: stations.get(toStationId)!.name, stopCount: r.end - r.start, rideMinutes: r.minutes, recommendations: [...unique.values()], recommendationStatus: completeDoors ? 'complete' as const : 'local' as const, recommendationBasis: [completeDoors ? '依据全程连续站内通道及固定车门位置联合优化' : '仅在已记录且编号已确认的车门范围内按连续站内路径联合比较；未覆盖尚未采集的车门，不能保证全车最优'], arrivalPath: optimized.choices[0].paths[index + 1], formationCars: data.formations.find(f => f.id === r.service.formationId)!.cars }
  })
  const paths = [primary.originPath, ...primary.transferPaths, primary.destinationPath]
  const walkingMetres = paths.reduce((s, p) => s + p.metres, 0), stairCount = paths.reduce((s, p) => s + p.stairCount, 0), rideMinutes = sumKnown(rides.map(r => r.minutes))
  const transfers = primary.transferPaths.map((path, i) => ({ stationId: legs[i].toStationId, stationName: legs[i].toStationName, fromLineName: legs[i].lineName, toLineName: legs[i + 1].lineName, path, instructions: [`从${primary.positions[i].car}号车厢${primary.positions[i].door}号门下车`, ...path.instructions, `在${legs[i + 1].lineName}往${legs[i + 1].direction}方向，前往${primary.positions[i + 1].car}号车厢${primary.positions[i + 1].door}号门候车`] }))
  const isDemo = data.provenance.kind === 'demo' || paths.some(p => p.edges.some(e => e.provenance.kind === 'demo'))
  return { id: rides.map(r => `${r.service.id}:${r.start}-${r.end}`).join('|'), legs, transfers, originPath: primary.originPath, destinationPath: primary.destinationPath, doorCombinations: combos, walkingMetres, stairCount, rideMinutes, totalMinutes: rideMinutes === null ? null : rideMinutes + paths.reduce((s, p) => s + p.minutes, 0), transferCount: rides.length - 1, confidence: isDemo ? 'demo' : completeDoors ? 'verified' : 'partial', equalChoicesTruncated: optimized.truncated, granularity: completeDoors ? 'detailed' : 'partial' }
}

function sumKnown(values: (number | null)[]): number | null { return values.some(v => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0) }

/** Retains useful line navigation while enriching only the actually recorded arrival station. */
function makeBasicRoute(data: MetroDataset, rides: Ride[], mode: RouteMode): JourneyRoute {
  const stations = new Map(data.stations.map(s => [s.id, s])), platforms = new Map(data.platforms.map(p => [p.id, p]))
  const legs: JourneyLeg[] = rides.map((ride, index) => {
    const fromStationId = ride.service.stops[ride.start].stationId, toStationId = ride.service.stops[ride.end].stationId, line = data.lines.find(l => l.id === ride.service.lineId)!
    const platform = platforms.get(ride.service.stops[ride.end].platformId ?? ''), formation = data.formations.find(f => f.id === ride.service.formationId)!
    const nextRide = rides[index + 1], nextPlatform = nextRide && !nextRide.connection ? platforms.get(nextRide.service.stops[nextRide.start].platformId ?? '') : undefined
    const transferTargets = nextPlatform ? Object.values(nextPlatform.doorNodes) : []
    let choices: { position: DoorPosition; path: WalkPath; toNextPlatform: boolean }[] = []
    if (platform) {
      for (const toNextPlatform of transferTargets.length ? [true, false] : [false]) {
        const targets = toNextPlatform ? transferTargets : stations.get(toStationId)!.concourseNodeIds
        choices = formation.positions.flatMap(position => {
          if (formation.numberingStatus === 'unknown' && position.numberingConfirmed !== true) return []
          const node = platform.doorNodes[position.id]
          const path = node && targets.length ? findWalkPath(data, [node], targets, mode) : null
          return path ? [{ position, path, toNextPlatform }] : []
        })
        if (choices.length) break
      }
    }
    choices.sort((a, b) => compare(metric(a.path, mode), metric(b.path, mode)))
    const equal = choices.filter(c => compare(metric(c.path, mode), metric(choices[0].path, mode)) === 0)
    return {
      serviceId: ride.service.id, lineId: line.id, lineName: line.name, lineColor: line.color, direction: ride.service.direction,
      fromStationId, fromStationName: stations.get(fromStationId)!.name, toStationId, toStationName: stations.get(toStationId)!.name,
      stopCount: ride.end - ride.start, rideMinutes: ride.minutes,
      formationCars: formation.cars,
      recommendations: equal.map(c => ({ car: c.position.car, door: c.position.door, positionId: c.position.id })),
      recommendationStatus: equal.length ? 'local' : 'pending', arrivalPath: equal[0]?.path ?? null,
      recommendationBasis: equal.length ? [equal[0].toNextPlatform ? '仅依据本换乘站已录入的到达车门→下一站台路径计算；未与其他乘车段联合优化' : '仅依据到达站已录入的车门→付费站厅路径计算；未指定出口，进站与后续换乘路径仍待补充', '只比较已录入且编号已确认的车门，不能保证覆盖所有实际车门'] : ['尚无已确认的车门编号、位置或通行路径，保留基础乘车指引'],
    }
  })
  const transfers = rides.slice(1).map((ride, i) => {
    const external = ride.connection
    return { stationId: legs[i].toStationId, stationName: external ? `${legs[i].toStationName} → ${legs[i + 1].fromStationName}` : legs[i].toStationName, fromLineName: legs[i].lineName, toLineName: legs[i + 1].lineName, path: null,
      kind: external ? 'external' as const : 'in-station' as const, fromStationId: legs[i].toStationId, toStationId: legs[i + 1].fromStationId,
      instructions: external ? [`在${legs[i].toStationName}出站，前往${legs[i + 1].fromStationName}重新进站，换乘${legs[i + 1].lineName}`, external.wheelchair === 'blocked' ? '此站外连接已标记为轮椅不可通行；普通路线可参考现场导向，步行距离和用时尚未录入' : '站外步行距离、用时与连续无障碍通道尚未录入，请核对现场指引'] : [`在${legs[i].toStationName}换乘${legs[i + 1].lineName}往${legs[i + 1].direction}方向`, '车门及连续站内换乘路径尚待补充，请依照现场导向'],
    }
  })
  const partial = legs.some(l => l.recommendations.length > 0)
  return { id: rides.map(r => `${r.service.id}:${r.start}-${r.end}${r.connection ? `@${r.connection.id}` : ''}`).join('|'), legs, transfers,
    originPath: null, destinationPath: null, doorCombinations: [], walkingMetres: null, stairCount: null, rideMinutes: sumKnown(rides.map(r => r.minutes)), totalMinutes: null, transferCount: rides.length - 1,
    confidence: data.provenance.kind === 'demo' ? 'demo' : partial ? 'partial' : 'topology-only', granularity: partial ? 'partial' : 'basic', equalChoicesTruncated: false }
}

/** Each required connection is assessed independently; missing data elsewhere
 * must never revive a fully recorded connection that the selected mode blocks. */
function indoorEvidence(data: MetroDataset, rides: Ride[], mode: RouteMode, cache: Map<string, WalkPath | null>): { unknown: boolean; blocked: boolean } {
  const nodes = new Map(data.walkNodes.map(n => [n.id, n])), platforms = new Map(data.platforms.map(p => [p.id, p]))
  const stations = new Map(data.stations.map(s => [s.id, s])), formations = new Map(data.formations.map(f => [f.id, f]))
  let unknown = false, blocked = false
  const completeStation = (stationId: string) => stations.get(stationId)!.indoorData === 'complete' &&
    !data.walkNodes.some(n => n.stationId === stationId && n.knowledge === 'unknown') &&
    !data.walkEdges.some(e => nodes.get(e.from)?.stationId === stationId && (e.knowledge === 'unknown' || mode === 'elevator' && e.wheelchair === 'unknown'))
  const doors = (ride: Ride, index: number): string[] | null => {
    const platform = platforms.get(ride.service.stops[index].platformId ?? ''), formation = formations.get(ride.service.formationId)!
    if (!platform || !formation.positions.length || formation.doorsKnown === false || formation.numberingStatus === 'unknown' && formation.positions.some(p => !p.numberingConfirmed)) return null
    const ids = formation.positions.map(p => platform.doorNodes[p.id])
    return ids.every(Boolean) ? ids : null
  }
  const check = (stationId: string, from: string[] | null, to: string[] | null) => {
    if (!from || !to || !completeStation(stationId)) { unknown = true; return }
    const key = `${from.join(',')}|${to.join(',')}`
    if (!cache.has(key)) cache.set(key, findWalkPath(data, from, to, mode))
    if (!cache.get(key)) blocked = true
  }
  const first = rides[0], last = rides[rides.length - 1]
  check(first.service.stops[first.start].stationId, stations.get(first.service.stops[first.start].stationId)!.concourseNodeIds, doors(first, first.start))
  rides.slice(1).forEach((ride, index) => {
    const previous = rides[index]
    if (ride.connection) { if (mode === 'elevator' && ride.connection.wheelchair === 'blocked') blocked = true; else unknown = true }
    else check(previous.service.stops[previous.end].stationId, doors(previous, previous.end), doors(ride, ride.start))
  })
  check(last.service.stops[last.end].stationId, doors(last, last.end), stations.get(last.service.stops[last.end].stationId)!.concourseNodeIds)
  return { unknown, blocked }
}

/** Enumerates bounded service itineraries, then DP over fixed in-train door positions. */
function planCoreJourney(data: MetroDataset, request: PlanRequest): PlanResult {
  const errors = validateDataset(data)
  if (errors.length) return { status: 'invalid', routes: [], diagnostics: errors }
  if (!['shortest', 'few-stairs', 'elevator'].includes(request.mode) || !data.stations.some(s => s.id === request.from) || !data.stations.some(s => s.id === request.to)) return { status: 'invalid', routes: [], diagnostics: ['请选择有效的起终点与路线模式'] }
  if (request.from === request.to) return { status: 'invalid', routes: [], diagnostics: ['起点与终点相同，无需乘坐地铁'] }
  const { candidates, truncated } = enumerateRides(data, request)
  const diagnostics = ['已录入站内数据时：范围为付费站厅 → 站台 → 换乘通道 → 终点付费站厅；未指定任何出口。', '线路候选按换乘次数及经过站数优先搜索；仅在乘车用时已知时应用最快方案2倍加10分钟的比较范围。时间不含候车，未使用时刻表或实时信息。']
  if (data.provenance.kind === 'demo') diagnostics.unshift('合成演示数据：城市、线路连接、方向、站台与车门设施均不能用于真实出行。')
  if (!candidates.length) return { status: truncated ? 'incomplete' : 'unreachable', routes: [], diagnostics: [...diagnostics, '在当前有界交路搜索范围内，没有找到线路连接。'] }
  // Apply the usability bound to feasible indoor routes, so inaccessible shortcuts do not suppress an accessible detour.
  const feasible: { route: JourneyRoute; rides: Ride[] }[] = []
  const walkCache = new Map<string, WalkPath | null>()
  for (const rides of candidates) {
    const optimized = optimizeDoors(data, rides, request.mode, walkCache)
    if (optimized.choices.length) feasible.push({ route: makeRoute(data, rides, optimized), rides })
  }
  if (!feasible.length) {
    const unknownCandidates = candidates.filter(rides => { const evidence = indoorEvidence(data, rides, request.mode, walkCache); return evidence.unknown && !evidence.blocked })
    if (unknownCandidates.length) {
      const minTransfers = Math.min(...unknownCandidates.map(r => r.length - 1))
      let routes = unknownCandidates.filter(r => r.length - 1 <= minTransfers + 1).map(r => makeBasicRoute(data, r, request.mode))
      const stops = (r: JourneyRoute) => r.legs.reduce((sum, leg) => sum + leg.stopCount, 0)
      const outside = (r: JourneyRoute) => r.transfers.filter(t => t.kind === 'external').length
      routes = routes.filter(candidate => !routes.some(other => other.transferCount < candidate.transferCount && outside(other) <= outside(candidate) && stops(other) <= stops(candidate)))
      routes.sort((a, b) => compare([a.transferCount, a.transfers.filter(t => t.kind === 'external').length, stops(a)], [b.transferCount, b.transfers.filter(t => t.kind === 'external').length, stops(b)]))
      const unique = [...new Map(routes.map(route => [route.id, route])).values()].slice(0, 6)
      return { status: request.mode === 'elevator' || truncated ? 'incomplete' : 'ok', routes: unique, diagnostics: [...diagnostics,
        '当前提供基础乘车路线；车门编号、设施位置、站内步行距离或时长未录入的部分保持未知。不会用固定车门或0米代替缺失数据。',
        request.mode === 'elevator' ? '电梯覆盖不等于连续无障碍通行已核实：以下仅为基础乘车方案，进站、换乘、轮椅通道和具体车门仍需补充确认。' : '站内数据不足以比较最少步行或最少楼梯，暂按换乘次数和经过站数排列；局部推荐仅对应已采集的到达站。',
        ...(truncated ? ['搜索达到安全上限，已优先保留最少换乘及较少经过站的候选，不保证覆盖全部备选。'] : []),
      ] }
    }
    return { status: truncated ? 'incomplete' : 'unreachable', routes: [], diagnostics: [...diagnostics, truncated ? '搜索尚未穷尽；已确认不可通过的连接不会作为基础方案返回。' : request.mode === 'elevator' ? '没有连续的已确认电梯及轮椅通行路径；已确认不可通过的进站、换乘或到达连接均已排除。' : '已采集的站内通道不连通，无法形成完整乘车方案。'] }
  }
  const minTransfers = Math.min(...feasible.map(f => f.route.transferCount))
  const transferEnvelope = feasible.map(f => f.route).filter(r => r.transferCount <= minTransfers + 1)
  // The time baseline must come from the SAME transfer envelope. An excluded
  // three-transfer shortcut must not eliminate every slower direct journey.
  const knownRide = transferEnvelope.flatMap(r => r.rideMinutes === null ? [] : [r.rideMinutes])
  const minRide = knownRide.length ? Math.min(...knownRide) : null
  const boundedRoutes = transferEnvelope.filter(r => r.rideMinutes === null || minRide === null || r.rideMinutes <= minRide * 2 + 10)
  // Keep distinct equal-transfer alternatives. Remove an extra-transfer detour
  // only when another feasible route is no worse on every walking/time metric.
  const routes = boundedRoutes.filter(candidate => !boundedRoutes.some(other =>
    other.transferCount < candidate.transferCount &&
    other.walkingMetres !== null && candidate.walkingMetres !== null && other.stairCount !== null && candidate.stairCount !== null && other.totalMinutes !== null && candidate.totalMinutes !== null &&
    other.walkingMetres <= candidate.walkingMetres + EPS &&
    other.stairCount <= candidate.stairCount + EPS &&
    other.totalMinutes <= candidate.totalMinutes + EPS,
  ))
  const routeCost = (r: JourneyRoute) => (request.mode === 'few-stairs' ? [r.stairCount, r.walkingMetres, r.totalMinutes, r.transferCount] : [r.walkingMetres, r.stairCount, r.totalMinutes, r.transferCount]).map(v => v ?? Infinity)
  routes.sort((a, b) => compare(routeCost(a), routeCost(b)))
  if (truncated) diagnostics.push('候选搜索达到安全上限，结果不保证覆盖所有交路，请缩小网络或完善搜索策略。')
  if (routes.some(r => r.equalChoicesTruncated)) diagnostics.push('等价车门组合超过256个，已截取；各段展示的位置须按同一组合使用。')
  diagnostics.push('车厢号按本交路编组编号；候车时应以现场车厢标识核对，不能简单理解为从行进方向数第几节。', '车门按全程固定位置优化；多个推荐位置须配合对应的完整车门组合，不能跨组合随意拼接。')
  const consideredStations = new Set(candidates.flatMap(r => [r[0].service.stops[r[0].start].stationId, ...r.map(leg => leg.service.stops[leg.end].stationId)]))
  if (data.stations.some(s => consideredStations.has(s.id) && s.indoorData !== 'complete') || data.walkNodes.some(n => consideredStations.has(n.stationId) && n.knowledge === 'unknown') || data.walkEdges.some(e => (e.knowledge === 'unknown' || request.mode === 'elevator' && e.wheelchair === 'unknown') && consideredStations.has(data.walkNodes.find(n => n.id === e.from)!.stationId))) diagnostics.push('相关车站存在部分未采集或未确认的设施与通行性。当前方案仅在已确认的连续通道内优化，不能保证在未采集路径范围内仍为最优。')
  if (routes.length > 6) diagnostics.push(`已找到${routes.length}条合规候选，界面显示成本最低的6条。`)
  return { status: truncated ? 'incomplete' : 'ok', routes: routes.slice(0, 6), diagnostics }
}

function connectionsFrom(data: MetroDataset, stationId: string): ExternalTransfer[] {
  return (data.externalTransfers ?? []).flatMap(link => link.fromStationId === stationId ? [link] : link.bidirectional && link.toStationId === stationId ? [{ ...link, fromStationId: stationId, toStationId: link.fromStationId }] : [])
}
function externalGuide(data: MetroDataset, link: ExternalTransfer) {
  const fromName = data.stations.find(s => s.id === link.fromStationId)!.name, toName = data.stations.find(s => s.id === link.toStationId)!.name
  return { stationId: link.fromStationId, stationName: `${fromName} → ${toName}`, fromStationId: link.fromStationId, toStationId: link.toStationId,
    fromLineName: '', toLineName: '', kind: 'external' as const, path: null,
    instructions: [`从${fromName}出站，前往${toName}重新进站`, link.wheelchair === 'blocked' ? '此站外连接已标记为轮椅不可通行；普通路线可参考现场导向，步行距离和用时尚未录入' : '站外实际步行距离、用时、出入口及连续无障碍通道尚未录入；请核对现场导向'],
  }
}
function attachEndpointConnections(data: MetroDataset, route: JourneyRoute, access?: ExternalTransfer, egress?: ExternalTransfer): JourneyRoute {
  const legs = route.legs.map(leg => ({ ...leg, recommendationStatus: leg.recommendations.length ? 'local' as const : 'pending' as const,
    recommendationBasis: leg.recommendations.length ? [...leg.recommendationBasis, '此推荐未包含站外衔接，不能视为完整行程或全车最优推荐'] : leg.recommendationBasis }))
  const partial = legs.some(l => l.recommendations.length > 0)
  return { ...route, id: `${access ? `access:${access.id}|` : ''}${route.id}${egress ? `|egress:${egress.id}` : ''}`,
    legs, accessTransfers: access ? [externalGuide(data, access)] : [], egressTransfers: egress ? [externalGuide(data, egress)] : [],
    originPath: access ? null : route.originPath, destinationPath: egress ? null : route.destinationPath,
    doorCombinations: [], walkingMetres: null, stairCount: null, totalMinutes: null, transferCount: route.transferCount + Number(!!access) + Number(!!egress),
    granularity: partial ? 'partial' : 'basic', confidence: route.confidence === 'demo' ? 'demo' : partial ? 'partial' : 'topology-only',
  }
}

/** Adds explicit station-to-station access/egress links without inventing an indoor map. */
export function planJourney(data: MetroDataset, request: PlanRequest): PlanResult {
  const base = planCoreJourney(data, request)
  if (base.status === 'invalid' || !(data.externalTransfers?.length)) return base
  const usable = (link: ExternalTransfer) => request.mode !== 'elevator' || link.wheelchair !== 'blocked'
  const access = connectionsFrom(data, request.from).filter(usable)
  const egress = (data.externalTransfers ?? []).filter(usable).flatMap(link => link.toStationId === request.to ? [link] : link.bidirectional && link.fromStationId === request.to ? [{ ...link, fromStationId: link.toStationId, toStationId: request.to }] : [])
  const direct = access.find(link => link.toStationId === request.to)
  const boundaryMessage = '出站换乘连接仅依据已记录站点关系；站外距离、用时、入口位置及连续无障碍通行尚未确认，不以0米或默认电梯路径替代。'
  if (direct) {
    const route: JourneyRoute = { id: `external-walk:${direct.id}:${request.from}`, legs: [], transfers: [], accessTransfers: [externalGuide(data, direct)], egressTransfers: [],
      originPath: null, destinationPath: null, doorCombinations: [], walkingMetres: null, stairCount: null, rideMinutes: 0, totalMinutes: null,
      transferCount: 1, confidence: data.provenance.kind === 'demo' ? 'demo' : 'topology-only', granularity: 'basic', equalChoicesTruncated: false }
    return { status: request.mode === 'elevator' ? 'incomplete' : 'ok', routes: [route], diagnostics: [boundaryMessage, '两站已有直接出站连接，无需为了到达相邻换乘站绕行乘车。'] }
  }
  if (!access.length && !egress.length) return base
  const extra: JourneyRoute[] = []
  const variants: { access?: ExternalTransfer; egress?: ExternalTransfer }[] = [
    ...access.map(link => ({ access: link })), ...egress.map(link => ({ egress: link })),
    ...access.flatMap(a => egress.map(e => ({ access: a, egress: e }))),
  ]
  for (const variant of variants) {
    const from = variant.access?.toStationId ?? request.from, to = variant.egress?.fromStationId ?? request.to
    if (from === to) continue
    const result = planCoreJourney(data, { ...request, from, to })
    extra.push(...result.routes.map(route => attachEndpointConnections(data, route, variant.access, variant.egress)))
  }
  if (!extra.length) return base
  const routes = [...new Map([...base.routes, ...extra].map(route => [route.id, route])).values()]
  const outsideCount = (r: JourneyRoute) => (r.accessTransfers?.length ?? 0) + (r.egressTransfers?.length ?? 0) + r.transfers.filter(t => t.kind === 'external').length
  const stopCount = (r: JourneyRoute) => r.legs.reduce((n, leg) => n + leg.stopCount, 0)
  routes.sort((a, b) => compare([a.transferCount, outsideCount(a), stopCount(a)], [b.transferCount, outsideCount(b), stopCount(b)]))
  return { status: request.mode === 'elevator' || base.status === 'incomplete' ? 'incomplete' : 'ok', routes: routes.filter(r => r.transferCount <= routes[0].transferCount + 1).slice(0, 6), diagnostics: [...base.diagnostics, boundaryMessage] }
}
