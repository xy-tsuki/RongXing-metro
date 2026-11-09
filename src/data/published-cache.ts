import { PUBLISHED_CACHE_KEY } from './data-sync'
import type { DataSnapshot } from './release-contract'
interface Storage { get(key:string):unknown; set(key:string,value:unknown):void }
const chunkKey = (slot:number,index:number) => `${PUBLISHED_CACHE_KEY}:${slot}:${index}`
/** Small keys for WeChat's per-key quota. Commit pointer last; failed writes keep the old generation. */
export function readPublishedCache(storage:Storage): unknown {
  const pointer = storage.get(PUBLISHED_CACHE_KEY) as any
  if (!pointer || pointer.format !== 'rongxing-data-cache/1') return pointer
  if (![0,1].includes(pointer.slot) || !Number.isInteger(pointer.count) || pointer.count<1 || pointer.count>64) throw new Error('缓存索引损坏')
  let text=''
  for(let i=0;i<pointer.count;i++) { const chunk=storage.get(chunkKey(pointer.slot,i));if(typeof chunk!=='string')throw new Error('缓存分片缺失');text+=chunk }
  return JSON.parse(text)
}
export function writePublishedCache(storage:Storage,value:DataSnapshot) {
  const pointer = storage.get(PUBLISHED_CACHE_KEY) as any
  const slot = pointer?.format==='rongxing-data-cache/1' && pointer.slot===0 ? 1 : 0
  const text = JSON.stringify(value), size=128*1024, count=Math.ceil(text.length/size)
  if(count>64)throw new Error('缓存超过支持大小')
  for(let i=0;i<count;i++)storage.set(chunkKey(slot,i),text.slice(i*size,(i+1)*size))
  storage.set(PUBLISHED_CACHE_KEY,{format:'rongxing-data-cache/1',slot,count})
}
