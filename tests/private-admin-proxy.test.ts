import { it, expect } from 'vitest'
import { createServer, request, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateAdminProxy } from '../scripts/maintenance/private-admin-proxy'

const listen = (server: Server) => new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)))
const close = (server: Server) => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
// Use the raw HTTP client so the test can deliberately exercise Host/Fetch-Metadata checks.
function call(url: string, options: { headers: Record<string, string>; method?: string }) {
  return new Promise<{ status: number; json: () => Promise<unknown> }>((resolve, reject) => {
    const req = request(url, options, res => {
      let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, json: async () => JSON.parse(body) }))
    }); req.on('error', reject); req.end()
  })
}
it('automatically authenticates local admin requests while rejecting cross-site and rebinding requests', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rongxing-local-proxy-')), tokenFile = join(directory, 'token')
  const fakeToken = 'test-only-credential-not-production-123456'
  writeFileSync(tokenFile, fakeToken)
  const upstream = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ authenticated: req.headers.authorization === `Bearer ${fakeToken}` })) })
  const upstreamPort = await listen(upstream)
  const proxy = createServer((req, res) => privateAdminProxy(tokenFile, upstreamPort)(req, res, () => { res.writeHead(404); res.end() }))
  const port = await listen(proxy)
  const headers = { Host: '127.0.0.1:5191', Origin: 'http://127.0.0.1:5191' }
  try {
    const admin = await call(`http://127.0.0.1:${port}/api/admin/batches`, { headers })
    expect(admin.status).toBe(200)
    expect(await admin.json()).toEqual({ authenticated: true })
    const publicRead = await call(`http://127.0.0.1:${port}/api/catalog`, { headers })
    expect(await publicRead.json()).toEqual({ authenticated: false })
    for (const badHeaders of [{ ...headers, Origin: 'https://evil.invalid' }, { ...headers, Host: 'evil.invalid' }, { Host: headers.Host }]) {
      expect((await call(`http://127.0.0.1:${port}/api/admin/batches`, { headers: badHeaders })).status).toBe(403)
    }
    expect((await call(`http://127.0.0.1:${port}/api/admin/history`, { headers: { Host: headers.Host, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200)
    expect(await (await call(`http://127.0.0.1:${port}/api/submissions`, { method: 'POST', headers })).json()).toEqual({ authenticated: false })
    expect((await call(`http://127.0.0.1:${port}/api/unrecognized`, { headers })).status).toBe(404)
  } finally { await close(proxy); await close(upstream); rmSync(directory, { recursive: true }) }
})
