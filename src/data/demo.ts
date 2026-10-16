import raw from './demo-network.json'
import { loadDatasetResult } from '../core/validation'
import type { MetroDataset, RouteMode } from '../core/types'
const loaded = loadDatasetResult(raw)
export const demoDataErrors = loaded.errors
// Keep the page renderable when someone edits the JSON into an invalid shape.
// The caller must show demoDataErrors and must not treat this empty shell as a network.
export const demoDataset: MetroDataset = loaded.data ?? {
  schemaVersion: '1.0', version: 'unavailable', city: { id: 'unavailable', name: '数据不可用' },
  description: '数据校验失败，请修复数据后重新加载。',
  provenance: { kind: 'demo', source: '无效数据的界面占位，不是可用路网', recordedAt: '2026-10-16' },
  stations: [], lines: [], formations: [], platforms: [], services: [], walkNodes: [], walkEdges: [],
}
export interface DemoScenario { id: string; title: string; description: string; from: string; to: string; mode: RouteMode }
export const demoScenarios: DemoScenario[] = [
  { id: 'direct', title: '同线直达', description: '演示1号线西门 → 滨江，含等价车门。', from: 's-west', to: 's-river', mode: 'shortest' },
  { id: 'one-transfer', title: '一次换乘', description: '在中央广场换乘演示2号线。', from: 's-west', to: 's-north', mode: 'shortest' },
  { id: 'multi-transfer', title: '两次换乘', description: '中央广场、科创园连续换乘，逐段优化车门。', from: 's-west', to: 's-bay', mode: 'shortest' },
  { id: 'few-stairs', title: '少走楼梯', description: '与同线直达比较，避开普通楼梯并改变推荐车门。', from: 's-west', to: 's-river', mode: 'few-stairs' },
  { id: 'accessible', title: '连续电梯', description: '进站、换乘、离开站台的所有楼层变化均有确认电梯。', from: 's-west', to: 's-bay', mode: 'elevator' },
  { id: 'unknown', title: '数据缺失', description: '缺测站的站厅、设施与通道未确认，不假设可达。', from: 's-west', to: 's-unknown', mode: 'elevator' },
]
