import type { Service } from '../core/types'

/** Optional display enrichment, independent of the route graph and stop pattern. */
export type ServiceClass = 'local' | 'limited-express' | 'direct-express'
export const serviceClassLabels: Record<ServiceClass, string> = {
  local: '普通', 'limited-express': '大站快车', 'direct-express': '直达快车',
}

/** Read explicit metadata only; a line name or stop count cannot identify a train class. */
export function serviceClassFor(service?: Service, enrichment?: ServiceClass): ServiceClass | undefined {
  if (enrichment && Object.prototype.hasOwnProperty.call(serviceClassLabels, enrichment)) return enrichment
  const metadata = service as (Service & { serviceLabel?: unknown }) | undefined
  const labels: Record<string, ServiceClass> = {
    '普通': 'local', '普通列车': 'local', '普通列车（非快车）': 'local',
    '大站快车': 'limited-express', '直达快车': 'direct-express',
  }
  if (typeof metadata?.serviceLabel === 'string' && Object.prototype.hasOwnProperty.call(labels, metadata.serviceLabel)) return labels[metadata.serviceLabel]
  return undefined
}
