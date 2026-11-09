import { expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import raw from '../src/data/fuzhou-network.json'
import type { MetroDataset } from '../src/core/types'
import { createCatalog } from '../src/maintenance/catalog'
import { readWorkbook, writeWorkbook } from '../scripts/maintenance/workbook'

it('exports the new brand and keeps legacy workbook sync baselines readable', async () => {
  const state = createCatalog(raw as MetroDataset)
  const bytes = await writeWorkbook(state, 'brand-compatibility')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as any)
  expect(wb.creator).toBe('榕乘')
  expect(wb.getWorksheet('_榕乘同步')?.state).toBe('hidden')
  expect((await readWorkbook(bytes, state)).exportId).toBe('brand-compatibility')
  wb.getWorksheet('_榕乘同步')!.name = '_榕行同步'
  expect((await readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), state)).exportId).toBe('brand-compatibility')
  const conflict = wb.addWorksheet('_榕乘同步')
  conflict.addRow(['rongxing-export/1', 'different-export'])
  await expect(readWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), state)).rejects.toThrow('不同的同步基线')
})
