import { resolve } from 'node:path'
import { importTimetable } from './maintenance/timetable-import'
const args = process.argv.slice(2), archive = args.find(a => !a.startsWith('--'))
if (!archive) throw new Error('用法：timetable-import <导入包.zip> [--apply]；默认仅预览')
const database = resolve(process.env.RONGXING_DATA_DIR ?? 'output/maintenance-data', 'rongxing.sqlite')
const output = resolve(process.env.RONGXING_TIMETABLE_OUTPUT ?? 'output/timetable-import-20261017')
importTimetable(database, resolve(archive), output, args.includes('--apply')).then(({ report }) => console.log(JSON.stringify(report, null, 2))).catch(e => { console.error((e as Error).message); process.exitCode = 1 })
