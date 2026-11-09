import {it,expect} from 'vitest'
import {createRequire} from 'node:module'
import {createServer,request, type Server} from 'node:http'
const {createLanAdminGateway,inSubnet,safePath}=createRequire(import.meta.url)('../scripts/maintenance/lan-admin-gateway.cjs')
const listen=(s:Server)=>new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as any).port)))
const close=(s:Server)=>new Promise<void>(r=>{s.close(()=>r());s.closeAllConnections()})
it('restricts clients and static paths without exposing private files',()=>{
  expect(inSubnet('10.28.38.17','10.28.38.0/27')).toBe(true)
  expect(inSubnet('10.28.38.40','10.28.38.0/27')).toBe(false)
  for(const p of ['/output/private-maintenance-admin/admin-token.local','/.git/config','/@fs/E:/project/output/key','/@id/E:/project/output/key','/@id/__x00__E:/project/output/key','/src/../output/key','/src/%252e%252e/output/key','/src/%2e%2e/output/key'])expect(safePath(p,'E:/project')).toBe(false)
  expect(safePath('/src/main.ts','E:/project')).toBe(true)
  expect(safePath('/node_modules/.vite/deps/vue.js','E:/project')).toBe(true) // Vite's dependency modules are required by the UI
})
it('forwards same-origin admin requests but rejects rebinding, cross-site writes and caller credentials',async()=>{
  let seen:any
  const upstream=createServer((req,res)=>{seen=req.headers;res.setHeader('Content-Type','application/json');res.end('{}')})
  const up=await listen(upstream),gateway=createLanAdminGateway({host:'127.0.0.1',port:5191,subnet:'127.0.0.0/8',project:process.cwd(),upstreamPort:up}),port=await listen(gateway)
  const call=(path:string,headers:any={},method='GET')=>new Promise<number>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path,method,headers:{Host:'127.0.0.1:5191',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!))});req.on('error',reject);req.end()})
  try{
    expect(await call('/api/admin/batches',{Authorization:'caller-secret',Cookie:'session=caller'})).toBe(200)
    expect(seen.authorization).toBeUndefined();expect(seen.cookie).toBeUndefined();expect(seen.origin).toBe(`http://127.0.0.1:${up}`)
    expect(await call('/api/admin/review',{Origin:'http://127.0.0.1:5191'},'POST')).toBe(200)
    expect(await call('/api/admin/review',{},'POST')).toBe(403)
    expect(await call('/api/admin/batches',{Origin:'https://evil.invalid'})).toBe(403)
    expect(await call('/api/admin/batches',{Host:'evil.invalid'})).toBe(403)
    expect(await call('/output/private-maintenance-admin/admin-token.local')).toBe(404)
  }finally{await close(gateway);await close(upstream)}
})
