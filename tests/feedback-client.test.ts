import { describe, expect, it, vi, afterEach } from 'vitest'
import { newFeedbackRequestId, submitFeedback, APP_VERSION, BUILD_ID } from '../src/feedback-client'

afterEach(() => vi.unstubAllGlobals())
describe('快速反馈客户端契约', () => {
  it('请求编号可复用且不从用户资料构造', () => {
    const ids = Array.from({ length: 100 }, newFeedbackRequestId)
    expect(new Set(ids).size).toBe(100)
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))).toBe(true)
  })
  it('主动提交时附版本，收到真实回执才成功', async () => {
    const request = vi.fn(options => options.success({ statusCode: 201, data: { id: 'FB-test', status: 'received', duplicate: false } }))
    vi.stubGlobal('uni', { request })
    const id = newFeedbackRequestId()
    await expect(submitFeedback({ requestId: id, category: 'bug', message: '测试问题' })).resolves.toMatchObject({ id: 'FB-test' })
    expect(request.mock.calls[0][0].data).toEqual({ requestId: id, category: 'bug', message: '测试问题', schemaVersion: 'feedback/1', appVersion: APP_VERSION, buildId: BUILD_ID })
  })
  it('限流、伪成功和网络超时均明确拒绝', async () => {
    const input = { requestId: newFeedbackRequestId(), category: 'other' as const, message: '自动化反馈' }
    vi.stubGlobal('uni', { request: (o: any) => o.success({ statusCode: 429, data: { error: '请稍后重试' } }) })
    await expect(submitFeedback(input)).rejects.toThrow('请稍后重试')
    vi.stubGlobal('uni', { request: (o: any) => o.success({ statusCode: 200, data: {} }) })
    await expect(submitFeedback(input)).rejects.toThrow('反馈未提交成功')
    vi.stubGlobal('uni', { request: (o: any) => o.fail() })
    await expect(submitFeedback(input)).rejects.toThrow('保留草稿')
  })
})
