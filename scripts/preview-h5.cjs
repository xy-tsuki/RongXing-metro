// Serve the built H5 preview, without exposing the repository or maintenance API.
const http = require('node:http')
const fs = require('node:fs/promises')
const path = require('node:path')
const args = process.argv.slice(2)
const option = (name, fallback) => args[args.indexOf(name) + 1] && args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const host = option('--host', '127.0.0.1'), port = Number(option('--port', '5173'))
const root = path.resolve(__dirname, '../dist/build/h5')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
http.createServer(async (request, response) => {
  const send = (status, data, type = 'text/plain; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : data)
  }
  if (!['GET', 'HEAD'].includes(request.method)) return send(405, 'Preview is read-only')
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    if (name === '/api' || name.startsWith('/api/')) return send(503, '{"error":"Maintenance service is local only"}', 'application/json')
    if (name !== '/' && name !== '/index.html' && !/^\/(assets|static)\//.test(name)) return send(404, 'Not found')
    if (name.includes('\\') || name.split('/').some(part => part === '..' || part.startsWith('.'))) return send(404, 'Not found')
    const file = await fs.realpath(path.resolve(root, '.' + (name === '/' ? '/index.html' : name)))
    if (!file.startsWith(root + path.sep) || !types[path.extname(file)]) return send(404, 'Not found')
    send(200, await fs.readFile(file), types[path.extname(file)])
  } catch { send(404, 'Not found') }
}).listen(port, host, () => console.log(`Rongxing H5 preview: http://${host}:${port}/`))
