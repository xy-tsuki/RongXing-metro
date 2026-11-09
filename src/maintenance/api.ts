// Mini-program requests require an absolute HTTPS URL; H5 uses its existing origin.
const base = import.meta.env.DEV && import.meta.env.VITE_PRIVATE_ADMIN === '1' ? '' : (import.meta.env.VITE_MAINTENANCE_API as string | undefined) ?? (import.meta.env.UNI_PLATFORM === 'mp-weixin' ? 'https://metro.xy-tsuki.top' : '')
export function maintenanceRequest<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: unknown, token = '', binary = false): Promise<T> {
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
