import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'

/** Local development only. The browser never receives the server's credential. */
export function privateAdminProxy(tokenFile: string, upstreamPort = 18787, origin = 'http://127.0.0.1:5191') {
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) { next(); return }
    const deny = (status: number, message: string) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: message })) }
    // Prevent cross-site requests and DNS rebinding to this credential-bearing local proxy.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin ? req.headers.origin !== origin : req.headers['sec-fetch-site'] !== 'same-origin')) { deny(403, '仅允许本机管理页面访问'); return }
    if (!['GET', 'POST'].includes(req.method ?? '') || !/^\/api\/(?:catalog|dataset|health|submissions)(?:\?|$)|^\/api\/admin\/|^\/api\/data\/(?:current(?:\?|$)|snapshot\/[a-f0-9]{64}(?:\?|$))/.test(req.url)) { deny(404, '接口不存在'); return }
    let token: string
    try { token = readFileSync(tokenFile, 'utf8').trim(); if (token.length < 24) throw new Error('missing') } catch { deny(503, '私有管理凭据未就绪，请重新运行本机启动器'); return }
    const upstream = request({ host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method,
      headers: { Origin: origin, ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
        ...(req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}),
        ...(req.url.startsWith('/api/admin/') ? { Authorization: `Bearer ${token}` } : {}) } }, incoming => {
      res.writeHead(incoming.statusCode ?? 502, { 'Content-Type': incoming.headers['content-type'] ?? 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      incoming.pipe(res)
    })
    upstream.setTimeout(20000, () => upstream.destroy())
    upstream.on('error', () => { if (!res.headersSent) deny(503, '私有连接不可用，请重新运行本机启动器'); else res.destroy() })
    req.on('aborted', () => upstream.destroy())
    req.pipe(upstream)
  }
}
