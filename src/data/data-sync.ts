import { validateDataSnapshot, releaseIdValid, type DataSnapshot, type DataManifest } from './release-contract'

export const PUBLISHED_CACHE_KEY = 'rongxing:published-data:fuzhou:1'
export interface SyncIO {
  request<T>(path: string): Promise<T>
  read(): unknown
  write(value: DataSnapshot): void
  changed(value: DataSnapshot): void
  status(message: string): void
}
/** One in-flight check, whole-version replacement, last-known-good fallback. */
export class DataSync {
  current: DataSnapshot | null = null
  private pending: Promise<void> | null = null
  private checkedAt = 0
  constructor(private io: SyncIO) {
    try { const saved = io.read(); if (saved) { validateDataSnapshot(saved); this.install(saved); io.status('使用已缓存发布数据') } } catch { io.status('缓存无效，使用随包数据') }
  }
  private install(value: DataSnapshot) { this.current = value; this.io.changed(value) }
  refresh(force = false): Promise<void> {
    if (this.pending) return this.pending
    if (!force && Date.now() - this.checkedAt < 60000) return Promise.resolve()
    this.checkedAt = Date.now()
    this.pending = this.check().finally(() => { this.pending = null })
    return this.pending
  }
  private async check() {
    try {
      const manifest = await this.io.request<DataManifest>('/api/data/current')
      if (manifest?.format !== 'rongxing-data-manifest/1' || !releaseIdValid(manifest.version)) throw new Error('数据服务版本不兼容')
      if (this.current?.version === manifest.version) { this.io.status('已是最新发布数据'); return }
      const snapshot = await this.io.request<unknown>(`/api/data/snapshot/${manifest.version}`)
      validateDataSnapshot(snapshot)
      if (snapshot.version !== manifest.version || snapshot.timetable.version !== manifest.timetableVersion) throw new Error('版本不一致，保留原数据')
      this.install(snapshot)
      try { this.io.write(snapshot); this.io.status('已更新到最新发布数据') }
      catch { this.io.status('已更新；本机缓存空间不足，离线时使用旧缓存') }
    } catch { this.io.status(this.current ? '更新暂不可用，保留已缓存发布数据' : '更新暂不可用，使用随包数据') }
  }
}
