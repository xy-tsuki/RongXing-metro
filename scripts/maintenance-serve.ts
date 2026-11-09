import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createCatalog } from '../src/maintenance/catalog'
import { validateDataset } from '../src/core/validation'
import { MaintenanceStore } from './maintenance/store'
import { MaintenanceService } from './maintenance/service'
import { createMaintenanceServer } from './maintenance/server'

const directory = resolve(process.env.RONGXING_DATA_DIR ?? 'output/maintenance-data')
mkdirSync(directory, { recursive: true })
if (process.env.RONGXING_REQUIRE_EXISTING === '1' && !existsSync(resolve(directory, 'rongxing.sqlite'))) throw new Error('生产维护库缺失，拒绝自动初始化')
const keyPath = resolve(directory, 'admin-token.local')
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 })
const token = readFileSync(keyPath, 'utf8').trim()
const dataset = JSON.parse(readFileSync(resolve(process.env.RONGXING_SEED ?? 'src/data/fuzhou-network.json'), 'utf8'))
const errors = validateDataset(dataset)
if (errors.length) throw new Error(errors.join('\n'))
const store = new MaintenanceStore(resolve(directory, 'rongxing.sqlite'), createCatalog(dataset))
const currentErrors = validateDataset(store.read().dataset)
if (currentErrors.length) { store.close(); throw new Error(currentErrors.join('\n')) }
if (process.argv.includes('--backup')) { console.log(JSON.stringify(store.backup())); store.close(); process.exit(0) }
const port = Number(process.env.RONGXING_PORT ?? 8787)
const origins = (process.env.RONGXING_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173').split(',')
const server = createMaintenanceServer(new MaintenanceService(store), token, origins)
server.requestTimeout = 15000
server.headersTimeout = 10000
server.timeout = 15000
server.maxConnections = 32
server.listen(port, '127.0.0.1', () => console.log(`榕乘维护服务：http://127.0.0.1:${port}\n数据库：${store.path}\n管理员密钥文件：${keyPath}\n服务仅监听本机；密钥不会写入前端。`))
const stop = () => server.close(() => { store.close(); process.exit(0) })
process.on('SIGINT', stop); process.on('SIGTERM', stop)
