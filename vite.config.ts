import { defineConfig, loadEnv } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { privateAdminProxy } from './scripts/maintenance/private-admin-proxy'
import { publicDevProxy } from './scripts/maintenance/public-dev-proxy'
export default defineConfig(({ command, mode }) => {
  // 公开服务地址只放在被忽略的 .env.local，未配置时本机预览不代理 /api/
  const upstream = loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_API_ORIGIN
  const localAdmin = command === 'serve' && process.env.RONGXING_LOCAL_ADMIN === '1'
  return { plugins: [uni(), ...(localAdmin ? [{ name: 'rongxing-private-admin', configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use(privateAdminProxy(process.env.RONGXING_ADMIN_TOKEN_FILE ?? 'output/private-maintenance-admin/admin-token.local'))
  } }] : command === 'serve' && upstream ? [{ name:'rongxing-public-api', configureServer(server: import('vite').ViteDevServer) { server.middlewares.use(publicDevProxy(upstream)) } }] : [])], define: { 'import.meta.env.VITE_PRIVATE_ADMIN': JSON.stringify(localAdmin ? '1' : '') }, server: { host: '127.0.0.1', port: 5173 } }
})
