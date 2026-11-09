import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createCatalog } from '../src/maintenance/catalog'
import network from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { MaintenanceStore } from '../scripts/maintenance/store'
import { backupLocationFromEnv, copySequentialBackup, listBackups, rollingBackup, verifyBackup } from '../scripts/maintenance/backup'

vi.mock('node:fs',async()=>{const actual=await vi.importActual<typeof import('node:fs')>('node:fs');return {...actual,statfsSync:vi.fn(actual.statfsSync)}})
const sqlite=Number(process.versions.node.split('.')[0])>=22

function fixture(count=9) {
  const directory=fs.mkdtempSync(join(tmpdir(),'rx-retention-')),path=join(directory,'rongxing.sqlite')
  const store=new MaintenanceStore(path,createCatalog(network as MetroDataset))
  const { DatabaseSync }=createRequire(import.meta.url)('node:sqlite'),db=new DatabaseSync(path)
  const originals:string[]=[]
  for(let i=0;i<count;i++){
    const name=`rongxing.sqlite.${i%2?'before-timetable-':''}${randomUUID()}.bak.sqlite`,backup=join(directory,name)
    db.prepare('VACUUM INTO ?').run(backup);fs.utimesSync(backup,100000+i,100000+i);originals.unshift(name)
  }
  return {directory,path,store,db,originals,close:()=>{db.close();store.close();fs.rmSync(directory,{recursive:true,force:true})}}
}

describe('NAS顺序备份复制',()=>{
  it('streams bytes without overwriting an existing destination',()=>{
    const directory=fs.mkdtempSync(join(tmpdir(),'rx-copy-')),source=join(directory,'source.sqlite'),destination=join(directory,'destination.sqlite')
    const data=Buffer.alloc(16*1024+37,91)
    try{
      fs.writeFileSync(source,data)
      copySequentialBackup(source,destination)
      expect(fs.readFileSync(destination)).toEqual(data)
      expect(()=>copySequentialBackup(source,destination)).toThrow()
      expect(fs.readFileSync(destination)).toEqual(data)
    }finally{fs.rmSync(directory,{recursive:true,force:true})}
  })
})

describe('NAS备份配置',()=>{
  it('requires the target, dedicated mount and protected reserve together',()=>{
    const before={directory:process.env.RONGXING_BACKUP_DIR,mount:process.env.RONGXING_BACKUP_MOUNT,reserve:process.env.RONGXING_BACKUP_RESERVE_FILE}
    try{
      delete process.env.RONGXING_BACKUP_DIR;delete process.env.RONGXING_BACKUP_MOUNT;delete process.env.RONGXING_BACKUP_RESERVE_FILE
      expect(backupLocationFromEnv()).toBeUndefined()
      process.env.RONGXING_BACKUP_DIR='/nas/backup'
      expect(()=>backupLocationFromEnv()).toThrow('NAS备份配置不完整')
    }finally{
      if(before.directory===undefined)delete process.env.RONGXING_BACKUP_DIR;else process.env.RONGXING_BACKUP_DIR=before.directory
      if(before.mount===undefined)delete process.env.RONGXING_BACKUP_MOUNT;else process.env.RONGXING_BACKUP_MOUNT=before.mount
      if(before.reserve===undefined)delete process.env.RONGXING_BACKUP_RESERVE_FILE;else process.env.RONGXING_BACKUP_RESERVE_FILE=before.reserve
    }
  })
})

describe.skipIf(!sqlite)('滚动保留五份完整备份',()=>{
  it('backs up first, retains current plus the latest four, and audits exact deleted hashes',()=>{
    const f=fixture()
    const foreign=join(f.directory,`foreign.sqlite.${randomUUID()}.bak.sqlite`),unrecognized=join(f.directory,'rongxing.sqlite.manual.bak.sqlite')
    fs.writeFileSync(foreign,'keep');fs.writeFileSync(unrecognized,'keep')
    const unrelatedDirectory=join(f.directory,`rongxing.sqlite.${randomUUID()}.bak.sqlite`);fs.mkdirSync(unrelatedDirectory)
    const before=f.store.read()
    try{
      const result=f.store.backup(),kept=listBackups(f.path).map(p=>p.name)
      expect(result.retained).toBe(5);expect(result.pruned).toBe(5)
      expect(kept).toHaveLength(5);expect(kept).toContain(result.path.split(/[\\/]/).at(-1))
      expect(f.originals.slice(0,4).every(name=>kept.includes(name))).toBe(true)
      expect(f.originals.slice(4).every(name=>!fs.existsSync(join(f.directory,name)))).toBe(true)
      for(const file of listBackups(f.path))verifyBackup(file.path)
      expect(f.store.read()).toEqual(before)
      expect(fs.readFileSync(foreign,'utf8')).toBe('keep');expect(fs.existsSync(unrecognized)).toBe(true);expect(fs.statSync(unrelatedDirectory).isDirectory()).toBe(true)
      const records=fs.readFileSync(join(f.directory,'backup-retention.jsonl'),'utf8').trim().split('\n').map(r=>JSON.parse(r))
      const completed=records.find(r=>r.status==='complete')
      expect(completed.deleted).toHaveLength(5);expect(completed.kept).toHaveLength(5)
      expect(completed.remove.every((r:any)=>/^[a-f0-9]{64}$/.test(r.sha256))).toBe(true)
      const next=rollingBackup(f.path,p=>f.db.prepare('VACUUM INTO ?').run(p),'timetable')
      expect(next.pruned).toBe(1);expect(next.path).toContain('before-timetable-');expect(listBackups(f.path)).toHaveLength(5)
    }finally{f.close()}
  })
  it('never prunes old backups when creation or verification fails; releases the lock for retry',()=>{
    const f=fixture()
    try{
      expect(()=>rollingBackup(f.path,p=>{fs.writeFileSync(p,'partial');throw new Error('write failed')})).toThrow('write failed')
      expect(listBackups(f.path)).toHaveLength(9)
      expect(()=>rollingBackup(f.path,p=>fs.writeFileSync(p,'corrupt'))).toThrow()
      expect(listBackups(f.path)).toHaveLength(9)
      expect(fs.readdirSync(f.directory).some(n=>n.includes('.pending') || n.endsWith('backup-lock'))).toBe(false)
      const id=randomUUID(),pending=join(f.directory,`.backup-${id}.pending`);fs.writeFileSync(pending,'pre-existing; do not remove')
      expect(()=>rollingBackup(f.path,()=>{throw new Error('must not create')},'maintenance',id)).toThrow('拒绝覆盖')
      expect(fs.readFileSync(pending,'utf8')).toBe('pre-existing; do not remove')
      expect(f.store.backup().retained).toBe(5)
    }finally{f.close()}
  })
  it('checks disk reserve before creation and does not delete to make room',()=>{
    const f=fixture();const original=vi.mocked(fs.statfsSync).getMockImplementation()!
    try{
      vi.mocked(fs.statfsSync).mockReturnValue({bavail:0,bsize:4096} as any)
      const create=vi.fn()
      expect(()=>rollingBackup(f.path,create)).toThrow('磁盘空间不足')
      expect(create).not.toHaveBeenCalled();expect(listBackups(f.path)).toHaveLength(9)
    }finally{vi.mocked(fs.statfsSync).mockImplementation(original);f.close()}
  })
  it('serializes backup processes and refuses pruning when a retained copy is corrupt',()=>{
    const f=fixture()
    try{
      const lock=join(f.directory,'rongxing.sqlite.backup-lock');fs.mkdirSync(lock)
      expect(()=>f.store.backup()).toThrow('备份任务正在运行');expect(listBackups(f.path)).toHaveLength(9);fs.rmdirSync(lock)
      fs.writeFileSync(join(f.directory,f.originals[0]),'corrupt retained backup')
      expect(()=>f.store.backup()).toThrow()
      expect(listBackups(f.path)).toHaveLength(10)
      expect(f.originals.every(name=>fs.existsSync(join(f.directory,name)))).toBe(true)
    }finally{f.close()}
  })
})
