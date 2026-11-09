import { it, expect } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { publicDevProxy } from '../scripts/maintenance/public-dev-proxy'
const listen=(server:Server)=>new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as any).port)))
const close=(server:Server)=>new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections()})
it('connects ordinary previews to the public service and never forwards admin routes or caller credentials',async()=>{
  const calls:{path:string;headers:any}[]=[]
  const upstream=createServer((req,res)=>{calls.push({path:req.url!,headers:req.headers});req.resume();res.setHeader('Content-Type','application/json');res.end('{"revision":0}')})
  const port=await listen(upstream)
  const proxy=createServer((req,res)=>publicDevProxy(`http://127.0.0.1:${port}`)(req,res,()=>{res.writeHead(404);res.end()}))
  const local=await listen(proxy)
  const call=(path:string,headers:Record<string,string>={},method='GET',body='')=>new Promise<number>((resolve,reject)=>{
    const req=request(`http://127.0.0.1:${local}${path}`,{method,headers:{Host:`127.0.0.1:${local}`,Origin:`http://127.0.0.1:${local}`,...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!))});req.on('error',reject);req.end(body)
  })
  try{
    expect(await call('/api/catalog',{Authorization:'Bearer must-not-forward',Cookie:'private=must-not-forward'})).toBe(200)
    expect(calls[0].headers.authorization).toBeUndefined();expect(calls[0].headers.cookie).toBeUndefined()
    expect(calls[0].headers.origin).toBe(`http://127.0.0.1:${port}`)
    expect(await call('/api/data/current')).toBe(200)
    expect(await call('/api/submissions',{'Content-Type':'application/json'},'POST','{}')).toBe(200)
    for(const path of ['/api/admin/batches','/api/admin/data/publish','/api/data/snapshot/invalid'])expect(await call(path)).toBe(404)
    expect(await call('/api/catalog',{Origin:'https://evil.invalid'})).toBe(403)
    expect(await call('/api/catalog',{Host:'evil.invalid',Origin:'http://evil.invalid'})).toBe(403)
    expect(await call('/api/submissions',{'Content-Length':'64001'},'POST')).toBe(413)
    expect(calls).toHaveLength(3)
    await close(upstream)
    expect(await call('/api/catalog')).toBe(503)
  }finally{await close(proxy);if(upstream.listening)await close(upstream)}
})
