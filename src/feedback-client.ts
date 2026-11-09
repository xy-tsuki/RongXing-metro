/** Shared contract for the independently developed feedback UI. No automatic telemetry. */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '0.1.0-alpha.1-dev'
export const BUILD_ID = import.meta.env.VITE_BUILD_ID || 'local-dev'
export type FeedbackCategory = 'bug' | 'data' | 'suggestion' | 'other'
export interface FeedbackInput {
  requestId: string
  category: FeedbackCategory
  message: string
  contact?: string
  context?: Partial<Record<'page' | 'fromStationId' | 'toStationId' | 'mode' | 'departureAt' | 'routeId' | 'dataVersion' | 'timetableVersion', string>>
}
export interface FeedbackReceipt { id: string; status: 'received'; duplicate: boolean }

/** Retain this ID and the draft for network retries; use a new ID after editing submitted content. */
export function newFeedbackRequestId(): string {
  // #ifdef H5
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // #endif
  // Non-secret idempotency ID; compatible with uni-app mini-program runtimes.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16)
    return (char === 'x' ? random : (random & 3) | 8).toString(16)
  })
}

export function submitFeedback(input: FeedbackInput): Promise<FeedbackReceipt> {
  const base = import.meta.env.VITE_FEEDBACK_API || ''
  return new Promise((resolve, reject) => uni.request({
    url: `${base}/api/feedback`, method: 'POST', timeout: 15000,
    header: { 'Content-Type': 'application/json' },
    data: { ...input, schemaVersion: 'feedback/1', appVersion: APP_VERSION, buildId: BUILD_ID },
    success: response => {
      const body = response.data as Partial<FeedbackReceipt> & { error?: string }
      if ((response.statusCode === 200 || response.statusCode === 201) && body.status === 'received' && body.id) resolve(body as FeedbackReceipt)
      else reject(new Error(body.error || `反馈未提交成功（${response.statusCode}），请保留草稿后重试。`))
    },
    fail: () => reject(new Error('暂时无法提交反馈，请保留草稿后重试。'))
  }))
}
