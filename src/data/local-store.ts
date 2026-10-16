import type { MetroDataset } from '../core/types'
import { validateDataset } from '../core/validation'

const keyFor = (base: MetroDataset) => `rongmetro:station-data:${base.city.id}:${base.version}`
/** Native uni storage keeps personal surveys on this device; the base package stays untouched. */
export function loadPersonalDataset(base: MetroDataset): { dataset: MetroDataset; warning?: string } {
  try {
    const saved = uni.getStorageSync(keyFor(base))
    if (!saved) return { dataset: JSON.parse(JSON.stringify(base)) }
    const candidate = typeof saved === 'string' ? JSON.parse(saved) : saved
    const errors = validateDataset(candidate)
    if (errors.length || candidate.city.id !== base.city.id || base.provenance.kind !== 'demo' && candidate.provenance.kind === 'demo') return { dataset: JSON.parse(JSON.stringify(base)), warning: '本机补充资料未通过校验或与当前线网不符，已使用原始数据包。' }
    return { dataset: candidate }
  } catch { return { dataset: JSON.parse(JSON.stringify(base)), warning: '无法读取本机补充资料，已使用原始数据包。' } }
}

export function savePersonalDataset(base: MetroDataset, dataset: MetroDataset): void {
  const errors = validateDataset(dataset)
  if (errors.length) throw new Error(errors.join('\n'))
  uni.setStorageSync(keyFor(base), JSON.stringify(dataset))
}
