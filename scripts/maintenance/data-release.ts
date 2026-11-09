import { mkdirSync, readFileSync, existsSync, readdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { projectApprovedPositions } from './approved-positions'
import { MaintenanceStore, digest } from './store'
import { releaseIdValid, validateDataSnapshot, type DataSnapshot, type DataManifest, type HolidayCalendar } from '../../src/data/release-contract'
import calendarSeed from '../../src/data/china-holidays.json'

type Selection = { importId?: string; releaseId?: string }
interface Publication extends DataManifest { actor: string; note: string; previous: string | null; backupId: string }
/** Additive sidecar snapshots: existing SQLite schema and original evidence are untouched. */
export class DataReleases {
  readonly directory: string
  constructor(readonly store: MaintenanceStore) { this.directory = join(dirname(store.path), 'published-data'); mkdirSync(this.directory, { recursive: true, mode: 0o700 }) }
  manifest(): DataManifest | null {
    const path = join(this.directory, 'current.json')
    if (!existsSync(path)) return null
    const { format, version, publishedAt, timetableVersion } = JSON.parse(readFileSync(path,'utf8')) as Publication
    if (format !== 'rongxing-data-manifest/1' || !releaseIdValid(version)) throw new Error('发布指针损坏')
    return { format, version, publishedAt, timetableVersion }
  }
  snapshot(version: string): DataSnapshot {
    if (!releaseIdValid(version)) throw new Error('无效发布ID')
    const value = JSON.parse(readFileSync(join(this.directory, `${version}.json`),'utf8')) as DataSnapshot
    const { version: _, ...payload } = value
    if (value.version !== version || digest(Buffer.from(JSON.stringify(payload))) !== version) throw new Error('发布快照摘要不符')
    return value
  }
  history(): Publication[] {
    return readdirSync(this.directory).filter(f => /^publication-[a-f0-9-]+\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(this.directory,f),'utf8'))).sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0,100)
  }
  private write(path: string, value: unknown) {
    const fd = openSync(path,'wx',0o600)
    try { writeFileSync(fd,JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
  }
  private candidate(selection: Selection) {
    if (!!selection.importId === !!selection.releaseId) throw new Error('请选择一个导入版本或历史发布版本')
    const state = this.store.read()
    let payload: Omit<DataSnapshot,'version'>
    if (selection.releaseId) {
      // Only releases that have a publication record can be rolled back to.
      if (!this.history().some(p => p.version === selection.releaseId)) throw new Error('历史发布不存在')
      const { version: _, ...old } = this.snapshot(selection.releaseId); payload = old
    } else {
      const calendarPath = join(dirname(this.store.path),'service-calendar.json')
      const calendar: HolidayCalendar = existsSync(calendarPath) ? JSON.parse(readFileSync(calendarPath,'utf8')) : calendarSeed
      payload = { format: 'rongxing-data/1', dataset: projectApprovedPositions(state), timetable: this.store.timetableBundle(selection.importId!), calendar }
    }
    const snapshot = { ...payload, version: digest(Buffer.from(JSON.stringify(payload))) }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 8 * 1024 * 1024) throw new Error('发布数据超过8MB，请先评估客户端兼容，当前版本未改变')
    validateDataSnapshot(snapshot)
    const current = this.manifest()
    const token = digest(Buffer.from(JSON.stringify({ version: snapshot.version, revision: state.revision, selection, current: current?.version ?? null })))
    return { snapshot, token, revision: state.revision, current }
  }
  preview(selection: Selection) {
    const { snapshot, token, revision, current } = this.candidate(selection)
    const previous = current ? this.snapshot(current.version) : null
    const oldTrips = new Map(previous?.timetable.trips.map(t=>[t.id,JSON.stringify(t)]) ?? [])
    let added = 0, changed = 0
    for (const trip of snapshot.timetable.trips) { if (!oldTrips.has(trip.id)) added++; else if (oldTrips.get(trip.id) !== JSON.stringify(trip)) changed++ }
    const nextIds = new Set(snapshot.timetable.trips.map(t=>t.id))
    return { token, revision, version: snapshot.version, currentVersion: current?.version ?? null, timetableVersion: snapshot.timetable.version,
      previousTimetableVersion: previous?.timetable.version ?? null, stations: snapshot.dataset.stations.length, trips: snapshot.timetable.trips.length,
      previousTrips: previous?.timetable.trips.length ?? 0, stops: snapshot.timetable.trips.reduce((n,t) => n+t.stops.length,0),
      calendarYears: snapshot.calendar.years.map(y=>y.year), notice: snapshot.timetable.notice, rollback: !!selection.releaseId,
      difference: { addedTrips:added, changedTrips:changed, removedTrips:[...oldTrips.keys()].filter(id=>!nextIds.has(id)).length,
        networkChanged: JSON.stringify(previous?.dataset) !== JSON.stringify(snapshot.dataset), calendarChanged: JSON.stringify(previous?.calendar) !== JSON.stringify(snapshot.calendar) } }
  }
  publish(input: Selection & { token: string; confirm: string; actor: string; note: string }) {
    const selection = input.releaseId ? { releaseId: input.releaseId } : { importId: input.importId }
    const { snapshot, token, current } = this.candidate(selection)
    if (input.token !== token || input.confirm !== snapshot.version) throw new Error('预览已变化或尚未确认，请重新预览')
    if (!input.actor?.trim() || !input.note?.trim()) throw new Error('请填写发布人和说明')
    if (current?.version === snapshot.version) return current
    if (readdirSync(this.directory).length > 2000) throw new Error('发布档案过多，请先私下归档，当前版本未改变')
    const backup = this.store.backup()
    if (this.candidate(selection).token !== token) throw new Error('备份期间数据已变化，请重新预览；旧发布未改变')
    const path = join(this.directory,`${snapshot.version}.json`)
    if (existsSync(path)) this.snapshot(snapshot.version); else this.write(path,snapshot)
    const record: Publication = { format:'rongxing-data-manifest/1', version:snapshot.version, publishedAt:new Date().toISOString(), timetableVersion:snapshot.timetable.version,
      actor: input.actor.trim(), note: input.note.trim(), previous:current?.version ?? null, backupId:backup.id }
    this.write(join(this.directory,`publication-${randomUUID()}.json`),record)
    const pending = join(this.directory,`pointer-${randomUUID()}.tmp`)
    this.write(pending,record); renameSync(pending,join(this.directory,'current.json'))
    // Persist the rename on Linux; Windows does not support directory fsync.
    if (process.platform !== 'win32') { const fd = openSync(this.directory,'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }
    return this.manifest()
  }
}
