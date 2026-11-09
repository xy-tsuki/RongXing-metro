import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, statfsSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'

export const BACKUP_RETENTION = 5
const RESERVE = 256 * 1024 * 1024
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
interface BackupFile { name:string; path:string; bytes:number; modified:number; ino:number; dev:number }
export interface BackupLocation { directory:string; mountRoot:string; reserveFile:string }
export function backupLocationFromEnv(): BackupLocation | undefined {
  const directory=process.env.RONGXING_BACKUP_DIR, mountRoot=process.env.RONGXING_BACKUP_MOUNT, reserveFile=process.env.RONGXING_BACKUP_RESERVE_FILE
  if(!directory&&!mountRoot&&!reserveFile)return undefined
  if(!directory||!mountRoot||!reserveFile)throw new Error('NAS备份配置不完整；必须同时设置目录、挂载点和256MiB保留文件')
  return {directory,mountRoot,reserveFile}
}
function verifyBackupLocation(database:string, location:BackupLocation) {
  if(process.platform!=='linux')throw new Error('NAS备份挂载仅支持Linux上的SMBNetFS')
  const mountRoot=realpathSync(resolve(location.mountRoot)),directory=realpathSync(resolve(location.directory)),reserve=realpathSync(resolve(location.reserveFile))
  if(directory===mountRoot||!directory.startsWith(mountRoot+sep)||!reserve.startsWith(mountRoot+sep))throw new Error('NAS备份目录或保留文件不在专用挂载点内')
  const mounts=readFileSync('/proc/self/mountinfo','utf8').split('\n').flatMap(line=>{
    const parts=line.split(' - ');if(parts.length!==2)return []
    const fields=parts[0].split(' '),fsType=parts[1].split(' ')[0],point=fields[4]?.replace(/\\([0-7]{3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8)))
    return point?[{point,fsType}]:[]
  })
  if(!mounts.some(m=>m.point===mountRoot&&m.fsType==='fuse.smbnetfs'))throw new Error('NAS备份挂载未就绪；正式库和旧备份未改动')
  const stat=lstatSync(reserve)
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==RESERVE)throw new Error('NAS 256MiB保留文件缺失或大小不符；拒绝写入')
  const local=statfsSync(dirname(resolve(database)))
  if(local.bavail*local.bsize<RESERVE)throw new Error('Luckfox本地磁盘须至少保留256MiB；NAS备份未启动')
  return {directory,mountRoot}
}
/** Only this database's known backup filenames, never other files or symlinks. */
export function listBackups(database:string, backupDirectory?:string): BackupFile[] {
  const directory=realpathSync(resolve(backupDirectory??dirname(resolve(database)))), name=basename(database).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  const pattern=new RegExp(`^${name}\\.(?:before-timetable-)?${uuid}\\.bak\\.sqlite$`)
  return readdirSync(directory).filter(n=>pattern.test(n)).flatMap(name=>{
    const path=join(directory,name),s=lstatSync(path)
    return s.isFile() && !s.isSymbolicLink() ? [{name,path,bytes:s.size,modified:s.mtimeMs,ino:s.ino,dev:s.dev}] : []
  }).sort((a,b)=>b.modified-a.modified || a.name.localeCompare(b.name))
}
export function verifyBackup(path:string) {
  const { DatabaseSync }=createRequire(import.meta.url)('node:sqlite')
  const db=new DatabaseSync(path,{readOnly:true})
  try {
    if (db.prepare('SELECT version FROM rongxing_meta').get()?.version !== 1 || db.prepare('PRAGMA integrity_check').all().some((r:any)=>r.integrity_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('备份完整性或引用检查失败')
  } finally { db.close() }
}
function hash(path:string) {
  const fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024),digest=createHash('sha256')
  try { let n:number;while((n=readSync(fd,buffer,0,buffer.length,null))>0)digest.update(buffer.subarray(0,n));return digest.digest('hex') }
  finally {closeSync(fd)}
}
function syncDirectory(directory:string) {
  if(process.platform==='win32')return
  const fd=openSync(directory,'r');try{fsyncSync(fd)}finally{closeSync(fd)}
}
/** Stream a verified local snapshot to SMBNetFS; copyFileSync may use unsupported FUSE copy_file_range. */
export function copySequentialBackup(source:string,destination:string) {
  const input=openSync(source,'r'),buffer=Buffer.alloc(1024*1024)
  let output:number|undefined,ownsDestination=false
  try{
    output=openSync(destination,'wx',0o600);ownsDestination=true
    let count:number
    while((count=readSync(input,buffer,0,buffer.length,null))>0){
      let offset=0
      while(offset<count){const written=writeSync(output,buffer,offset,count-offset);if(written<=0)throw new Error('备份顺序复制未写入数据');offset+=written}
    }
    fsyncSync(output)
  }catch(e){
    if(output!==undefined){try{closeSync(output)}catch{};output=undefined}
    if(ownsDestination)try{const stat=lstatSync(destination);if(stat.isFile()&&!stat.isSymbolicLink())unlinkSync(destination)}catch{}
    throw e
  }finally{closeSync(input);if(output!==undefined)closeSync(output)}
}
function audit(directory:string,entry:unknown) {
  const fd=openSync(join(directory,'backup-retention.jsonl'),'a',0o600)
  try {writeFileSync(fd,JSON.stringify(entry)+'\n');fsyncSync(fd)}finally{closeSync(fd)}
}
/** Create first, validate, then prune. A single local lock serializes service, timer and import processes. */
export function rollingBackup(database:string,vacuum:(destination:string)=>void,kind:'maintenance'|'timetable'='maintenance',id=randomUUID(),location?:BackupLocation) {
  if(!new RegExp('^'+uuid+'$').test(id))throw new Error('备份ID无效')
  database=resolve(database)
  const sourceDirectory=realpathSync(dirname(database)),external=location?verifyBackupLocation(database,location):undefined,directory=external?.directory??sourceDirectory,lock=join(sourceDirectory,basename(database)+'.backup-lock')
  try{mkdirSync(lock,{mode:0o700})}catch(e){
    if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('备份任务正在运行；若曾异常中断，请维护者核查备份锁后重试')
    throw e
  }
  const name=basename(database)+'.'+(kind==='timetable'?'before-timetable-':'')+id+'.bak.sqlite',path=join(directory,name),pending=join(directory,'.backup-'+id+'.pending'),localPending=join(sourceDirectory,'.backup-'+id+'.local-pending')
  let ownsPending=false,backupHash=''
  try {
    if(existsSync(path)||existsSync(pending)||existsSync(localPending))throw new Error('备份ID已存在，拒绝覆盖')
    const sourceSize=lstatSync(database).size
    if(external){
      const local=statfsSync(sourceDirectory)
      if(local.bavail*local.bsize<sourceSize+RESERVE)throw new Error('Luckfox本地磁盘须能生成并校验新备份且预留256MiB；旧备份未清理')
    }else{
      const disk=statfsSync(directory)
      if(disk.bavail*disk.bsize<sourceSize+RESERVE)throw new Error('磁盘空间不足：须能先完成新备份并预留256MiB；旧备份未清理')
    }
    ownsPending=true
    const snapshot=external?localPending:pending
    try{
      vacuum(snapshot)
      verifyBackup(snapshot)
      const fd=openSync(snapshot,'r+');try{fsyncSync(fd)}finally{closeSync(fd)}
      if(external){
        copySequentialBackup(localPending,pending)
        const localHash=hash(localPending);backupHash=hash(pending)
        if(localHash!==backupHash)throw new Error('NAS顺序复制回读哈希不匹配')
      }
    }catch(e){if(external)throw new Error('NAS备份未完成，旧备份未清理：'+(e as Error).message);throw e}
    if(!external)backupHash=hash(snapshot)
    renameSync(pending,path);syncDirectory(directory)
    audit(external?sourceDirectory:directory,{at:new Date().toISOString(),id,policy:'latest-five/1',status:'created',created:name,sha256:backupHash})
    const backups=listBackups(database,directory),current=backups.find(b=>b.path===path)!
    const ordered=[current,...backups.filter(b=>b.path!==path)],kept=ordered.slice(0,BACKUP_RETENTION),removed=ordered.slice(BACKUP_RETENTION)
    // Local snapshots can be checked cheaply. NAS snapshots were verified locally before upload;
    // SMBNetFS random-page scans can block indefinitely, so only compare streamed SHA-256 on NAS.
    if(!external)for(const file of kept)if(file.path!==path){
      try{verifyBackup(file.path)}catch{
        audit(directory,{at:new Date().toISOString(),id,policy:'latest-five/1',status:'blocked',created:name,invalid:file.name})
        throw new Error('新备份已保存，但保留集校验失败，旧备份未清理：'+file.name)
      }
    }
    const plan=removed.map(f=>({...f,sha256:hash(f.path)}))
    const record={at:new Date().toISOString(),id,policy:'latest-five/1',created:name,kept:kept.map(f=>f.name),remove:plan}
    audit(external?sourceDirectory:directory,{...record,status:'planned'})
    const deleted:string[]=[]
    try {
      for(const file of plan){
        const s=lstatSync(file.path)
        if(!s.isFile()||s.isSymbolicLink()||realpathSync(dirname(file.path))!==directory||s.ino!==file.ino||s.dev!==file.dev||s.size!==file.bytes||s.mtimeMs!==file.modified)throw new Error('备份文件在核对后变化，停止清理')
        if(external){
          const legacy=join(sourceDirectory,file.name)
          try{
            const link=lstatSync(legacy),target=resolve(sourceDirectory,readlinkSync(legacy))
            if(link.isSymbolicLink()&&join(realpathSync(dirname(target)),basename(target))===file.path)unlinkSync(legacy)
          }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
        }
        unlinkSync(file.path)
        deleted.push(file.name)
      }
      syncDirectory(directory);audit(external?sourceDirectory:directory,{...record,status:'complete',deleted})
    }catch(e){audit(external?sourceDirectory:directory,{...record,status:'incomplete',deleted,error:(e as Error).message});throw new Error('新备份已保存，但旧备份清理未完成：'+(e as Error).message)}
    return {id,path,retained:kept.length,pruned:deleted.length}
  }finally{
    if(ownsPending&&existsSync(pending)){const s=lstatSync(pending);if(s.isFile()&&!s.isSymbolicLink())unlinkSync(pending)}
    if(ownsPending&&existsSync(localPending)){const s=lstatSync(localPending);if(s.isFile()&&!s.isSymbolicLink())unlinkSync(localPending)}
    rmdirSync(lock)
  }
}
