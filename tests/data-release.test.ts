import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { sha256 } from '../src/data/sha256'
import network from '../src/data/fuzhou-network.json'
import calendar from '../src/data/china-holidays.json'
import timetable from '../src/data/timetable-test.json'
import { validateDataSnapshot, snapshotDigest, type DataSnapshot } from '../src/data/release-contract'
import { DataSync, type SyncIO } from '../src/data/data-sync'
import { readPublishedCache, writePublishedCache } from '../src/data/published-cache'
import { createCatalog } from '../src/maintenance/catalog'
import { MaintenanceStore } from '../scripts/maintenance/store'
import { DataReleases } from '../scripts/maintenance/data-release'
import { MaintenanceService } from '../scripts/maintenance/service'
import { createMaintenanceServer } from '../scripts/maintenance/server'

const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v))
const snapshot = (label='base'):DataSnapshot => { const value:DataSnapshot={format:'rongxing-data/1',version:'',dataset:clone(network) as DataSnapshot['dataset'],timetable:clone(timetable) as DataSnapshot['timetable'],calendar:clone(calendar)};value.timetable.version+='-'+label;value.version=snapshotDigest(value);return value }
const manifest = (v:DataSnapshot) => ({format:'rongxing-data-manifest/1',version:v.version,timetableVersion:v.timetable.version,publishedAt:new Date().toISOString()})
afterEach(()=>vi.restoreAllMocks())
describe('发布包契约与自动更新',()=>{
  it('chunks the actual bundle and preserves the committed cache on a partial storage failure',()=>{
    const items=new Map<string,unknown>(),storage={get:(key:string)=>items.get(key),set:(key:string,value:unknown)=>{expect(JSON.stringify(value).length).toBeLessThan(1024*1024);items.set(key,value)}}
    const good=snapshot();writePublishedCache(storage,good);expect(readPublishedCache(storage)).toEqual(good)
    let count=0;expect(()=>writePublishedCache({...storage,set:(key,value)=>{if(++count===2)throw new Error('quota');storage.set(key,value)}},snapshot('next'))).toThrow('quota')
    expect(readPublishedCache(storage)).toEqual(good)
    writePublishedCache(storage,snapshot('final'));expect(readPublishedCache(storage)).toEqual(snapshot('final'))
  })
  it('verifies SHA-256 against the Node implementation for UTF-8 and block boundaries',()=>{for(const text of ['', 'abc', '榕乘😀', 'x'.repeat(55),'x'.repeat(56),'x'.repeat(64),JSON.stringify(timetable)])expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'))})
  it('validates the actual six-line bundle and rejects broken direction, duplicates, demo and calendars',()=>{
    expect(()=>validateDataSnapshot(snapshot())).not.toThrow()
    for(const mutate of [
      (s:DataSnapshot)=>s.timetable.trips[0].stops.reverse(),
      (s:DataSnapshot)=>s.timetable.trips.push(s.timetable.trips[0]),
      (s:DataSnapshot)=>s.timetable.trips[0].stops[0][0]='unknown',
      (s:DataSnapshot)=>s.dataset.provenance.kind='demo',
      (s:DataSnapshot)=>s.calendar.years[0].makeupWorkdays.push(s.calendar.years[0].holidays[0].start)
    ]) { const v=snapshot();mutate(v);expect(()=>validateDataSnapshot(v)).toThrow() }
  })
  it('checks only the small manifest when unchanged; atomically adopts updates and server rollback',async()=>{
    let remote=snapshot(), saved:unknown, active:DataSnapshot|undefined
    const request=vi.fn(async(path:string)=>path==='/api/data/current'?manifest(remote):clone(remote))
    const io:SyncIO={request:request as SyncIO['request'],read:()=>saved,write:v=>{saved=v},changed:v=>{active=v},status:vi.fn()}
    const sync=new DataSync(io)
    await Promise.all([sync.refresh(true),sync.refresh(true)]);expect(request).toHaveBeenCalledTimes(2);expect(active?.version).toBe(remote.version)
    await sync.refresh(true);expect(request).toHaveBeenCalledTimes(3)
    const old=remote;remote=snapshot('b'.repeat(64));await sync.refresh(true);expect(active?.version).toBe(remote.version)
    remote=old;await sync.refresh(true);expect(active?.version).toBe(old.version)
    const offline=new DataSync({...io,request:async()=>{throw new Error('offline')}})
    await offline.refresh(true);expect(offline.current?.version).toBe(old.version)
  })
  it('rejects inconsistent manifests and malformed snapshots without erasing cache',async()=>{
    const good=snapshot(), broken=snapshot('b'.repeat(64));broken.timetable.trips[0].serviceId='wrong'
    const changed=vi.fn(),write=vi.fn()
    const io:SyncIO={read:()=>good,write,changed,status:vi.fn(),request:async<T>(path:string)=> (path==='/api/data/current'?manifest(broken):broken) as T}
    const sync=new DataSync(io);await sync.refresh(true);expect(sync.current).toBe(good);expect(changed).toHaveBeenCalledTimes(1);expect(write).not.toHaveBeenCalled()
    io.request=async<T>(path:string)=>(path==='/api/data/current'?manifest(snapshot('b'.repeat(64))):good) as T
    await sync.refresh(true);expect(sync.current).toBe(good)
    io.request=async<T>()=>({format:'future/2'}) as T;await sync.refresh(true);expect(sync.current).toBe(good)
  })
  it('keeps live validated data when storage is full and throttles background checks',async()=>{
    const good=snapshot(),request=vi.fn(async(path:string)=>path==='/api/data/current'?manifest(good):good),status=vi.fn()
    const sync=new DataSync({read:()=>'{bad',write:()=>{throw new Error('quota')},changed:vi.fn(),status,request:request as SyncIO['request']})
    await sync.refresh();await sync.refresh();expect(request).toHaveBeenCalledTimes(2);expect(sync.current).toBe(good);expect(status).toHaveBeenLastCalledWith(expect.stringContaining('缓存空间不足'))
  })
  it('updates the shared planner but protects demo mode and saved personal copies',async()=>{
    vi.stubGlobal('uni',{getStorageSync:()=>undefined,setStorageSync:vi.fn()})
    try {
      const {publishedData}=await import('../src/data/published')
      const {useJourneySession}=await import('../src/navigation/session')
      const session=useJourneySession(),first=snapshot()
      first.dataset.version='published-test-a'
      publishedData.value=first
      expect(session.data.version).toBe('published-test-a');expect(session.timetable.value).toBe(first.timetable)
      session.useDataset('demo');publishedData.value=snapshot('new')
      expect(session.data.provenance.kind).toBe('demo')
      session.useDataset('real');expect(session.timetable.value.version).toContain('new')
      const personal=clone(session.data);personal.version='personal'
      session.applyDataset(personal);expect(session.personalCopyPresent.value).toBe(true)
      const next=snapshot('third');next.dataset.version='published-test-c';publishedData.value=next
      expect(session.data.version).toBe('personal');expect(session.timetable.value.version).not.toContain('third')
      publishedData.value=null
    } finally{vi.unstubAllGlobals()}
  })
})
const sqlite = Number(process.versions.node.split('.')[0])>=22
describe.skipIf(!sqlite)('独立SQLite发布与只读HTTP',()=>{
  it('does not publish imports automatically, requires a fresh preview and confirmation, backs up, rolls back and preserves DB',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'rx-release-')),path=join(dir,'rongxing.sqlite')
    const catalog=createCatalog(clone(network) as DataSnapshot['dataset'])
    catalog.rows[JSON.stringify(['fz-前屿','fz-l2-forward'])].电梯对应车厢车门='4:8;3:2'
    const store=new MaintenanceStore(path,catalog)
    const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite')
    const db=new DatabaseSync(path)
    db.exec('CREATE TABLE timetable_imports(id TEXT PRIMARY KEY, created_at TEXT, bundle_json TEXT)')
    db.prepare('INSERT INTO timetable_imports VALUES(?,?,?)').run('one','2026-10-19',JSON.stringify(timetable))
    const release=new DataReleases(store),before=JSON.stringify(store.read())
    const server=createMaintenanceServer(new MaintenanceService(store),'x'.repeat(32),[])
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as any).port}`
    try{
      expect(release.manifest()).toBeNull();expect((await fetch(base+'/api/data/current')).status).toBe(503)
      expect((await fetch(base+'/api/admin/data')).status).toBe(401)
      const preview=release.preview({importId:'one'})
      const input={importId:'one',token:preview.token,confirm:preview.version,actor:'isolated-test',note:'合成隔离验证'}
      expect(()=>release.publish({...input,confirm:''})).toThrow()
      db.prepare('UPDATE state SET revision=1,json=? WHERE id=1').run(JSON.stringify({...store.read(),revision:1}))
      expect(()=>release.publish(input)).toThrow('预览')
      const fresh=release.preview({importId:'one'});const first=release.publish({...input,token:fresh.token,confirm:fresh.version})!
      expect((await fetch(base+'/api/data/current')).status).toBe(200)
      const client=new DataSync({read:()=>null,write:()=>{},changed:()=>{},status:()=>{},request:async<T>(path:string)=>{const response=await fetch(base+path);if(!response.ok)throw new Error('http');return await response.json() as T}})
      await client.refresh(true);expect(client.current?.version).toBe(first.version)
      const publicSnapshot=await (await fetch(base+'/api/data/snapshot/'+first.version)).json();validateDataSnapshot(publicSnapshot)
      expect(publicSnapshot.dataset.approvedFacilityPositions).toHaveLength(1)
      expect(publicSnapshot.dataset.approvedFacilityPositions![0].positions).toEqual([{car:4,door:8},{car:3,door:2}])
      expect(JSON.stringify(publicSnapshot)).not.toContain('isolated-test');expect(JSON.stringify(publicSnapshot)).not.toContain('backupId')
      const secondBundle=clone(timetable);secondBundle.version+='-next'
      db.prepare('INSERT INTO timetable_imports VALUES(?,?,?)').run('two','2026-10-20',JSON.stringify(secondBundle))
      expect(release.manifest()?.version).toBe(first.version)
      const next=release.preview({importId:'two'});release.publish({...input,importId:'two',token:next.token,confirm:next.version})
      await client.refresh(true);expect(client.current?.version).toBe(next.version)
      const back=release.preview({releaseId:first.version});release.publish({releaseId:first.version,token:back.token,confirm:back.version,actor:'test',note:'回退'})
      await client.refresh(true);expect(client.current?.version).toBe(first.version)
      expect(release.manifest()?.version).toBe(first.version);expect(release.history()).toHaveLength(3)
      expect(JSON.stringify({...store.read(),revision:0})).toBe(before)
      expect(readdirSync(dir).filter(p=>p.endsWith('.bak.sqlite'))).toHaveLength(3)
      const pointer=readFileSync(join(dir,'published-data/current.json'),'utf8');expect(pointer).toContain('backupId')
      expect(db.prepare('PRAGMA integrity_check').get().integrity_check).toBe('ok')
    } finally{await new Promise<void>(r=>server.close(()=>r()));db.close();store.close();rmSync(dir,{recursive:true,force:true})}
  },15000)
})
