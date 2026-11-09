// 小程序请求必须用绝对 HTTPS 地址，H5 沿用当前页面来源。
// 服务地址不写进公开源码：小程序构建从本机被忽略的 .env.local 读取 VITE_PUBLIC_API_ORIGIN。
const miniProgram = import.meta.env.UNI_PLATFORM === 'mp-weixin'
const base = import.meta.env.DEV && import.meta.env.VITE_PRIVATE_ADMIN === '1' ? '' : (import.meta.env.VITE_MAINTENANCE_API as string | undefined) ?? (miniProgram ? (import.meta.env.VITE_PUBLIC_API_ORIGIN as string | undefined) ?? '' : '')
export function maintenanceRequest<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: unknown, token = '', binary = false): Promise<T> {
  if (miniProgram && !base) return Promise.reject(new Error('未配置服务地址（VITE_PUBLIC_API_ORIGIN），无法联网'))
  return new Promise((resolve, reject) => uni.request({
    url: `${base}${path}`, method, data: data as any,
    header: { 'Content-Type': data instanceof ArrayBuffer ? 'application/octet-stream' : 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    responseType: binary ? 'arraybuffer' : 'text', timeout: 20000,
    success: res => {
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data as T)
      else {
        let body: any = res.data
        if (body instanceof ArrayBuffer) { try { body = JSON.parse(new TextDecoder().decode(body)) } catch {} }
        reject(new Error(res.statusCode === 503 ? '采集服务暂不可用，请稍后重试。当前页面填写的内容仍保留。' : body?.error ?? `服务返回 ${res.statusCode}`))
      }
    }, fail: () => reject(new Error('暂时无法连接采集服务，请检查网络后重试。当前页面填写的内容仍保留。'))
  }))
}
export async function downloadMaintenance(path: string, token: string, filename: string) {
  // #ifdef H5
  const data = await maintenanceRequest<ArrayBuffer>(path, 'GET', undefined, token, true)
  const url = URL.createObjectURL(new Blob([data])), anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 3000)
  // #endif
  // #ifndef H5
  throw new Error('文件导入导出请使用网页管理员入口')
  // #endif
}
