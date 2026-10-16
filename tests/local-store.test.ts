import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadPersonalDataset, savePersonalDataset } from '../src/data/local-store'
import { fuzhouDataset } from '../src/data/fuzhou'
import { demoDataset } from '../src/data/demo'

afterEach(() => vi.unstubAllGlobals())
describe('device-local survey storage', () => {
  it('separates cities and base versions and never loads demo data into the real network', () => {
    const keys: string[] = []
    vi.stubGlobal('uni', { getStorageSync: (key: string) => { keys.push(key); return JSON.stringify(demoDataset) } })
    const loaded = loadPersonalDataset(fuzhouDataset)
    expect(loaded.dataset.city.id).toBe(fuzhouDataset.city.id)
    expect(loaded.warning).toContain('不符')
    loadPersonalDataset(demoDataset)
    loadPersonalDataset({ ...fuzhouDataset, version: 'next-release' })
    expect(new Set(keys).size).toBe(3)
  })
  it('keeps the base package unchanged and reports storage failure to the caller', () => {
    const before = JSON.stringify(fuzhouDataset)
    vi.stubGlobal('uni', { getStorageSync: () => '{bad json', setStorageSync: () => { throw new Error('quota exceeded') } })
    const loaded = loadPersonalDataset(fuzhouDataset)
    expect(loaded.warning).toContain('无法读取')
    expect(() => savePersonalDataset(fuzhouDataset, loaded.dataset)).toThrow('quota exceeded')
    expect(JSON.stringify(fuzhouDataset)).toBe(before)
  })
})
