import { randomUUID } from 'node:crypto'
import type { Catalog, FieldChange, Update } from '../../src/maintenance/catalog'
import { compareUpdates, validateUpdate } from '../../src/maintenance/catalog'
import { mergeStationPatch, validateStationPatch } from '../../src/maintenance/station-patch'
import type { StationPatch } from '../../src/maintenance/station-patch'
import { validateDataset } from '../../src/core/validation'
import { MaintenanceStore, digest } from './store'
import type { Batch } from './store'
import { readWorkbook, writeWorkbook } from './workbook'

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
export function requireEvidence(source: unknown, recordedAt: unknown) {
  if (typeof source !== 'string' || !source.trim() || source.length > 500 || typeof recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString().slice(0, 10) !== recordedAt) throw new Error('来源和有效的 YYYY-MM-DD 采集日期必填')
}
function leafDiff(before: any, after: any, path = ''): { field: string; before: unknown; after: unknown }[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object') return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(k => leafDiff(before[k], after[k], path ? `${path}.${k}` : k))
  return [{ field: path, before: before ?? null, after: after ?? null }]
}
export class MaintenanceService {
  constructor(readonly store: MaintenanceStore) {}
  stage(updates: Update[], source: string, recordedAt: string, raw: Buffer, base?: Catalog, warnings: string[] = [], supersedes?: string): Batch {
    requireEvidence(source, recordedAt)
    const state = this.store.read()
    if (!Array.isArray(updates) || updates.length > 5000) throw new Error('投稿须为记录数组，最多5000条')
    const changes = compareUpdates(state, updates, base)
    return this.store.stage({ id: randomUUID(), revision: state.revision, source, recordedAt, createdAt: new Date().toISOString(), warnings, updates, changes, status: changes.length ? 'pending' : 'reviewed', hash: digest(raw), supersedes, base }, raw)
  }
  async importWorkbook(raw: Buffer, source: string, recordedAt: string) {
    const parsed = await readWorkbook(raw, this.store.read())
    return this.stage(parsed.updates, source, recordedAt, raw, parsed.exportId ? this.store.base(parsed.exportId) : undefined, parsed.warnings)
  }
  patch(patch: StationPatch, raw: Buffer, supersedes?: string): Batch {
    const state = this.store.read()
    requireEvidence(patch?.provenance?.source, patch?.provenance?.recordedAt)
    if (state.dataset.provenance.kind !== 'demo' && patch.provenance.kind === 'demo') throw new Error('禁止将合成补丁投稿到真实线网')
    const errors = validateStationPatch(state.dataset, patch)
    if (errors.length) throw new Error(errors.join('\n'))
    const merged = mergeStationPatch(state.dataset, patch)
    if (!merged.data) throw new Error(merged.errors.join('\n'))
    const details = leafDiff(state.dataset, merged.data)
    const changes: FieldChange[] = details.length ? [{ id: 'navigation', entity: 'navigation', key: patch.station, field: '完整单站拓扑（成组审核）', before: null, after: patch, kind: 'modified', details }] : []
    return this.store.stage({ id: randomUUID(), revision: state.revision, source: patch.provenance.source, recordedAt: patch.provenance.recordedAt, createdAt: new Date().toISOString(), warnings: ['完整单站拓扑成组审核，防止拆分后引用失效'], updates: [], patch, changes, status: changes.length ? 'pending' : 'reviewed', hash: digest(raw), supersedes }, raw)
  }
  review(id: string, request: { revision: number; accept: string[]; reject: string[]; resolveConflicts?: boolean; actor: string; note: string }) {
    if (!request.actor?.trim() || !request.note?.trim()) throw new Error('审核人和审核说明必填')
    const batch = this.store.batch(id), state = this.store.read()
    if (batch.status !== 'pending' || batch.revision !== state.revision || request.revision !== state.revision) throw new Error('数据已变化，请刷新本批次差异后再审核')
    if (!Array.isArray(request.accept) || !Array.isArray(request.reject)) throw new Error('审核选择无效')
    const decisions = [...request.accept, ...request.reject]
    if (!decisions.length || new Set(decisions).size !== decisions.length || decisions.some(id => !batch.changes.some(c => c.id === id && !c.decision))) throw new Error('审核字段不存在、重复或已经审核')
    if (!request.resolveConflicts && batch.changes.some(c => request.accept.includes(c.id) && c.kind === 'conflict')) throw new Error('存在冲突，须明确确认使用投稿值')
    const next = clone(state)
    for (const change of batch.changes) {
      if (request.accept.includes(change.id)) {
        if (change.entity === 'navigation') {
          const merged = mergeStationPatch(next.dataset, batch.patch!)
          if (!merged.data) throw new Error(merged.errors.join('\n'))
          next.dataset = merged.data
        } else {
          next[change.entity][change.key] ??= {}
          next[change.entity][change.key][change.field] = change.after as string
        }
        change.decision = 'accepted'
      } else if (request.reject.includes(change.id)) change.decision = 'rejected'
    }
    for (const entity of ['rows', 'facilities', 'transfers'] as const) {
      const touched = new Set(batch.changes.filter(c => c.entity === entity && request.accept.includes(c.id)).map(c => c.key))
      for (const key of touched) {
        const errors = validateUpdate(next, { entity, key, values: next[entity][key] })
        if (errors.length) throw new Error(`选择的字段必须保持记录完整：${errors.join('\n')}`)
      }
    }
    const dataErrors = validateDataset(next.dataset)
    if (dataErrors.length) throw new Error(dataErrors.join('\n'))
    batch.status = batch.changes.every(c => c.decision) ? 'reviewed' : 'pending'
    batch.revision = state.revision + 1
    const backup = this.store.backup() // Failure aborts before changing formal data.
    return { ...this.store.commit(state.revision, next, batch, request.actor, request.note), backup }
  }
  refresh(id: string) {
    const batch = this.store.batch(id)
    if (batch.status !== 'pending') throw new Error('该批次已经审核完毕')
    if (batch.changes.some(c => c.decision)) {
      // Keep prior decisions immutable; only restage fields still awaiting review.
      const updates: Update[] = []
      for (const c of batch.changes.filter(c => !c.decision && c.entity !== 'navigation')) {
        let update = updates.find(u => u.entity === c.entity && u.key === c.key)
        if (!update) { update = { entity: c.entity as Update['entity'], key: c.key, values: {} }; updates.push(update) }
        update.values[c.field] = c.after === '' ? '【清空】' : c.after as string
      }
      for (const u of updates) if (u.entity !== 'rows') u.values = { ...this.store.read()[u.entity][u.key], ...u.values }
      return this.stage(updates, batch.source, batch.recordedAt, this.store.source(batch.hash), undefined, [`重新预览自 ${batch.id}`], batch.id)
    }
    if (batch.patch) return this.patch(batch.patch, this.store.source(batch.hash), batch.id)
    return this.stage(batch.updates, batch.source, batch.recordedAt, this.store.source(batch.hash), batch.base, [`重新预览自 ${batch.id}；保留原同步基线，无基线字段按冲突处理`], batch.id)
  }
  async exportWorkbook() {
    const state = this.store.read()
    return writeWorkbook(state, this.store.exportBase(state))
  }
}
