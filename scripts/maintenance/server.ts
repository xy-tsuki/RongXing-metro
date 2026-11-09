import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { MaintenanceService } from './service'
import { digest } from './store'
import { validatePublicUpdate } from '../../src/maintenance/submission-validation'
import { DataReleases } from './data-release'
import { releaseIdValid } from '../../src/data/release-contract'

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data))
}
async function body(req: IncomingMessage, maximum = 7 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > maximum) throw new Error('请求大小超限'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
export function createMaintenanceServer(service: MaintenanceService, token: string, origins: string[]) {
  if (token.length < 24) throw new Error('管理员密钥至少 24 字符')
  const limits = new Map<string, { time: number; count: number }>()
  const releases = new DataReleases(service.store)
  return createServer(async (req, res) => {
    const origin = req.headers.origin
    if (origin && !origins.includes(origin)) { send(res, 403, { error: '来源地址未授权' }); return }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    // Reject DNS rebinding even when no Origin was supplied.
    if (!/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$|^\[::1\](?::\d+)?$/.test(req.headers.host ?? '')) { send(res, 403, { error: '仅允许本机主机名' }); return }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const snapshotId = path.startsWith('/api/data/snapshot/') ? path.slice('/api/data/snapshot/'.length) : ''
    const publicRoute = req.method === 'GET' && (['/api/health', '/api/catalog', '/api/dataset', '/api/data/current'].includes(path) || releaseIdValid(snapshotId)) || req.method === 'POST' && path === '/api/submissions'
    const given = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const givenBytes = Buffer.from(given), tokenBytes = Buffer.from(token)
    const authorized = givenBytes.length === tokenBytes.length && timingSafeEqual(givenBytes, tokenBytes)
    if (!publicRoute && !authorized) { send(res, 401, { error: '需要管理员密钥' }); return }
    try {
      if (req.method === 'GET') {
        if (path === '/api/data/current') { const manifest = releases.manifest(); send(res, manifest ? 200 : 503, manifest ?? { error:'尚未发布数据' }); return }
        if (releaseIdValid(snapshotId)) {
          if (!releases.history().some(p => p.version === snapshotId)) { send(res,404,{ error:'发布版本不存在' }); return }
          send(res, 200, releases.snapshot(snapshotId)); return
        }
        if (path === '/api/admin/data') { send(res,200,{ current:releases.manifest(), imports:service.store.timetableImports(), history:releases.history() }); return }
        if (path === '/api/health') { send(res, 200, { status: 'ok', schema: 'maintenance/1', revision: service.store.read().revision }); return }
        if (path === '/api/catalog') {
          const state = service.store.read()
          send(res, 200, { revision: state.revision, rows: state.rows, facilities: state.facilities, transfers: state.transfers, stations: state.dataset.stations, lines: state.dataset.lines, services: state.dataset.services, externalTransfers: state.dataset.externalTransfers }); return
        }
        if (path === '/api/dataset') { send(res, 200, service.store.read().dataset); return }
        if (path === '/api/admin/batches') { send(res, 200, service.store.batches()); return }
        if (path === '/api/admin/history') { send(res, 200, service.store.history()); return }
        if (path === '/api/admin/export.xlsx') {
          const raw = await service.exportWorkbook()
          res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="rongxing-maintenance.xlsx"', 'Cache-Control': 'no-store' }); res.end(raw); return
        }
        if (path.startsWith('/api/admin/source/')) {
          const batch = service.store.batch(decodeURIComponent(path.slice('/api/admin/source/'.length)))
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="original-upload.bin"' }); res.end(service.store.source(batch.hash)); return
        }
      }
      if (req.method === 'POST') {
        const raw = await body(req, path === '/api/submissions' ? 64000 : 7 * 1024 * 1024)
        if (path === '/api/admin/import') {
          send(res, 200, await service.importWorkbook(raw, url.searchParams.get('source') ?? '', url.searchParams.get('date') ?? '')); return
        }
        if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('请使用 JSON 请求')
        const input = JSON.parse(raw.toString('utf8'))
        if (path === '/api/admin/data/preview') { send(res,200,releases.preview(input)); return }
        if (path === '/api/admin/data/publish') { send(res,200,releases.publish(input)); return }
        if (path === '/api/submissions') {
          const address = req.socket.remoteAddress ?? 'local', now = Date.now()
          if (limits.size > 1000) for (const [k, v] of limits) if (now - v.time > 60000) limits.delete(k)
          const limit = limits.get(address)
          if (limit && now - limit.time < 60000 && limit.count >= 20) { send(res, 429, { error: '投稿过于频繁，请稍后重试' }); return }
          limits.set(address, { time: limit && now - limit.time < 60000 ? limit.time : now, count: limit && now - limit.time < 60000 ? limit.count + 1 : 1 })
          // Public forms cannot submit navigation changes or rewrite system metadata.
          if (raw.length > 64000 || !Array.isArray(input.updates) || input.updates.length > 30) throw new Error('单次投稿最多30条、64KB')
          if (Object.keys(input).some(key => !['updates', 'source', 'recordedAt'].includes(key))) throw new Error('投稿包含不支持的字段')
          const state = service.store.read()
          for (const update of input.updates) {
            const errors = validatePublicUpdate(state, update)
            if (errors.length) throw new Error(errors.join('\n'))
          }
          const staged = service.store.pendingSubmission(digest(raw)) ?? service.stage(input.updates, input.source, input.recordedAt, raw)
          send(res, 201, { id: staged.id, count: staged.changes.length, status: staged.status }); return
        }
        if (path === '/api/admin/patch') { send(res, 200, service.patch(input, raw)); return }
        if (path === '/api/admin/review') { send(res, 200, service.review(input.id, input)); return }
        if (path === '/api/admin/refresh') { send(res, 200, service.refresh(input.id)); return }
        if (path === '/api/admin/backup') { send(res, 200, service.store.backup()); return }
        if (path === '/api/admin/restore') {
          if (!input.actor?.trim() || !input.note?.trim() || input.confirm !== input.historyId) throw new Error('回滚须填写审核人、说明并确认历史ID')
          service.store.backup()
          send(res, 200, service.store.restore(input.historyId, input.revision, input.actor, input.note)); return
        }
      }
      send(res, 404, { error: '接口不存在' })
    } catch (e) { send(res, 400, { error: (e as Error).message }) }
  })
}
