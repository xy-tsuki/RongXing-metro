import raw from './fuzhou-network.json'
import { loadDatasetResult } from '../core/validation'
import type { MetroDataset } from '../core/types'

const loaded = loadDatasetResult(raw)
export const fuzhouDataErrors = loaded.errors
/** Does not substitute the synthetic demo when the real network fails validation. */
export const fuzhouDataset: MetroDataset = loaded.data ?? {
  schemaVersion: '1.0', version: 'unavailable', city: { id: 'fuzhou', name: '福州' },
  description: '福州线网校验失败，请修复资料后重载。',
  provenance: { kind: 'official', source: '无效数据的界面占位，不可用于路线规划', recordedAt: '2026-10-16' },
  stations: [], lines: [], formations: [], platforms: [], services: [], walkNodes: [], walkEdges: [],
}
export const fuzhouCoverage = raw.coverage
export const fuzhouSources = raw.sources
