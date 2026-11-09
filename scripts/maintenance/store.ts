import { createRequire } from 'node:module'
import { mkdirSync, statSync, statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Catalog, FieldChange, Update } from '../../src/maintenance/catalog'
import type { StationPatch } from '../../src/maintenance/station-patch'
import { backupLocationFromEnv, rollingBackup } from './backup'

interface Statement { run(...args: any[]): unknown; get(...args: any[]): any; all(...args: any[]): any[] }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
export interface Batch {
  id: string; revision: number; source: string; recordedAt: string; createdAt: string
  warnings: string[]; changes: FieldChange[]; updates: Update[]; patch?: StationPatch
  status: 'pending' | 'reviewed' | 'superseded'; hash: string; supersedes?: string; base?: Catalog
}
export class MaintenanceStore {
  private db: Database
  constructor(readonly path: string, initial: Catalog) {
    const [major, minor] = process.versions.node.split('.').map(Number)
    if (major < 22 || major === 22 && minor < 13) throw new Error('维护服务需要 Node.js 22.13+；前端仍兼容原运行环境')
    mkdirSync(dirname(path), { recursive: true })
    const require = createRequire(import.meta.url)
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => Database }
    this.db = new DatabaseSync(path)
    // Reject unrelated databases rather than silently adding tables to them.
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name)
    if (tables.length && !tables.includes('rongxing_meta')) { this.db.close(); throw new Error('该文件不是榕乘维护数据库，拒绝修改') }
    const existingVersion = tables.includes('rongxing_meta') ? this.db.prepare('SELECT version FROM rongxing_meta').get() : undefined
    if (existingVersion && existingVersion.version !== 1) { this.db.close(); throw new Error('未知维护数据库版本，请先评估迁移，拒绝修改') }
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;')
    this.db.exec(`CREATE TABLE IF NOT EXISTS rongxing_meta (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (hash TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, raw BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, batch_id TEXT, before_json TEXT NOT NULL, after_json TEXT NOT NULL);`)
    const meta = this.db.prepare('SELECT version FROM rongxing_meta').get()
    if (meta && meta.version !== 1) { this.db.close(); throw new Error('未知维护数据库版本，请先评估迁移，未加载数据') }
    if (!meta) this.db.prepare('INSERT INTO rongxing_meta VALUES (1)').run()
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1, ?, ?)').run(initial.revision, JSON.stringify(initial))
  }
  close() { this.db.close() }
  read(): Catalog { return JSON.parse(this.db.prepare('SELECT json FROM state WHERE id=1').get().json) }
  timetableImports() {
    if (!this.db.prepare("SELECT name FROM sqlite_master WHERE name='timetable_imports'").get()) return []
    return this.db.prepare('SELECT id, created_at AS createdAt, json_extract(bundle_json, \'$.version\') AS version FROM timetable_imports ORDER BY rowid DESC').all()
  }
  timetableBundle(id: string) {
    if (!this.timetableImports().some(row => row.id === id)) throw new Error('时刻导入版本不存在')
    return JSON.parse(this.db.prepare('SELECT bundle_json FROM timetable_imports WHERE id=?').get(id).bundle_json)
  }
  batch(id: string): Batch {
    const row = this.db.prepare('SELECT json FROM batches WHERE id=?').get(id)
    if (!row) throw new Error('审核批次不存在')
    return JSON.parse(row.json)
  }
  batches(): Batch[] { return this.db.prepare("SELECT json FROM batches ORDER BY CASE WHEN json_extract(json, '$.status')='pending' THEN 0 ELSE 1 END, rowid DESC LIMIT 200").all().map(r => JSON.parse(r.json)) }
  pendingSubmission(hash: string): Batch | undefined {
    const row = this.db.prepare("SELECT json FROM batches WHERE json_extract(json,'$.hash')=? AND json_extract(json,'$.status')='pending' ORDER BY rowid DESC LIMIT 1").get(hash)
    return row ? JSON.parse(row.json) : undefined
  }
  history() { return this.db.prepare('SELECT id, created_at AS createdAt, actor, note, batch_id AS batchId FROM history ORDER BY rowid DESC LIMIT 200').all() }
  stage(batch: Batch, raw: Buffer): Batch {
    const storage = statfsSync(dirname(this.path))
    if (storage.bavail * storage.bsize < 256 * 1024 * 1024 || statSync(this.path).size > 512 * 1024 * 1024) throw new Error('维护库容量不足，请联系维护者归档后重试')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.read().revision !== batch.revision) throw new Error('数据已变化，请重新预览')
      if (batch.supersedes) {
        const previous = this.batch(batch.supersedes)
        if (previous.status !== 'pending') throw new Error('原批次已经审核或刷新')
        previous.status = 'superseded'
        this.db.prepare('UPDATE batches SET json=? WHERE id=?').run(JSON.stringify(previous), previous.id)
      }
      this.db.prepare('INSERT OR IGNORE INTO sources VALUES (?, ?, ?, ?)').run(batch.hash, batch.source, batch.createdAt, raw)
      this.db.prepare('INSERT INTO batches VALUES (?, ?)').run(batch.id, JSON.stringify(batch))
      this.db.exec('COMMIT'); return batch
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  exportBase(state: Catalog): string {
    const id = randomUUID()
    this.db.prepare('INSERT INTO exports VALUES (?, ?)').run(id, JSON.stringify(state)); return id
  }
  base(id: string): Catalog {
    const row = this.db.prepare('SELECT json FROM exports WHERE id=?').get(id)
    if (!row) throw new Error('同步基线不存在，请使用本库导出的文件；跨库文件请移除同步信息后按冲突审核导入')
    return JSON.parse(row.json)
  }
  source(hash: string): Buffer {
    const row = this.db.prepare('SELECT raw FROM sources WHERE hash=?').get(hash)
    if (!row) throw new Error('原始文件不存在')
    return Buffer.from(row.raw)
  }
  backup() {
    return rollingBackup(this.path,path=>this.db.prepare('VACUUM INTO ?').run(path),'maintenance',undefined,backupLocationFromEnv())
  }
  commit(expected: number, next: Catalog, batch: Batch, actor: string, note: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const before = this.read()
      if (before.revision !== expected || this.batch(batch.id).status !== 'pending') throw new Error('数据或审核状态已变化，请刷新预览后再审核')
      next.revision = before.revision + 1
      const id = randomUUID()
      // Full before/after snapshots are transactionally coupled to both data and review decisions.
      this.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), actor, note, batch.id, JSON.stringify(before), JSON.stringify(next))
      this.db.prepare('UPDATE state SET revision=?, json=? WHERE id=1').run(next.revision, JSON.stringify(next))
      this.db.prepare('UPDATE batches SET json=? WHERE id=?').run(JSON.stringify(batch), batch.id)
      this.db.exec('COMMIT'); return { revision: next.revision, historyId: id }
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  restore(historyId: string, expected: number, actor: string, note: string) {
    const row = this.db.prepare('SELECT before_json FROM history WHERE id=?').get(historyId)
    if (!row) throw new Error('历史记录不存在')
    const next: Catalog = JSON.parse(row.before_json)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const before = this.read()
      if (before.revision !== expected) throw new Error('数据已变化，请刷新')
      next.revision = before.revision + 1
      const id = randomUUID()
      this.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), actor, `回滚 ${historyId}：${note}`, null, JSON.stringify(before), JSON.stringify(next))
      this.db.prepare('UPDATE state SET revision=?, json=? WHERE id=1').run(next.revision, JSON.stringify(next))
      this.db.exec('COMMIT'); return { revision: next.revision, historyId: id }
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
}
export const digest = (raw: Buffer) => createHash('sha256').update(raw).digest('hex')
