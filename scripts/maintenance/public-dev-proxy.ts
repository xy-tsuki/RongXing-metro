import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** Ordinary local preview uses the existing public service, without admin credentials. */
// 上游地址由调用方从本机 .env.local 传入，公开源码不写服务地址。
export function publicDevProxy(upstream: string) {
  const target = new URL(upstream)
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) { next(); return }
    const send = (status:number,error:string) => { if(res.headersSent)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error})) }
    const host = req.headers.host ?? ''
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(host) || (req.headers.origin ? req.headers.origin !== `http://${host}` : req.headers['sec-fetch-site'] !== 'same-origin')) { send(403,'仅允许本机预览页面');return }
    const path = req.url.split('?')[0]
    const read = req.method === 'GET' && (['/api/catalog','/api/dataset','/api/health','/api/data/current'].includes(path) || /^\/api\/data\/snapshot\/[a-f0-9]{64}$/.test(path))
    const submission = req.method === 'POST' && path === '/api/submissions'
    if (!read && !submission) { send(404,'本机普通预览不提供管理接口');return }
    if (Number(req.headers['content-length'] ?? 0) > 64000) { res.setHeader('Connection','close');send(413,'投稿不得超过64KB');req.resume();return }
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = request(new URL(req.url,target),{method:req.method,headers:{Origin:target.origin,
      'User-Agent':req.headers['user-agent'] ?? 'Mozilla/5.0 (Rongxing local preview)',
      ...(req.headers['content-type'] ? {'Content-Type':req.headers['content-type']} : {}),
      ...(req.headers['content-length'] ? {'Content-Length':req.headers['content-length']} : {})}}, incoming=>{
      res.writeHead(incoming.statusCode ?? 502,{'Content-Type':incoming.headers['content-type'] ?? 'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
      incoming.pipe(res)
    })
    let bytes=0
    req.on('data',chunk=>{bytes+=chunk.length;if(bytes>64000){if(!res.headersSent)res.setHeader('Connection','close');send(413,'投稿不得超过64KB');req.unpipe(outgoing);outgoing.destroy();req.resume()}})
    outgoing.setTimeout(20000,()=>outgoing.destroy())
    outgoing.on('error',()=>{if(!res.headersSent)send(503,'公开采集服务暂不可用，请稍后重试；填写内容仍保留');else if(!res.writableEnded)res.destroy()})
    req.on('aborted',()=>outgoing.destroy()); req.pipe(outgoing)
  }
}
