// Only the maintenance service uses SQLite's Node 22+ runtime; app builds keep their existing runtime.
const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const candidates = [process.env.RONGXING_NODE, process.execPath, join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe')].filter(Boolean)
const node = candidates.find(p => {
  if (!existsSync(p)) return false
  const [major, minor] = (spawnSync(p, ['-p', 'process.versions.node'], { encoding: 'utf8', windowsHide: true }).stdout?.trim() ?? '').split('.').map(Number)
  return major > 22 || major === 22 && minor >= 13
})
if (!node) { console.error('维护服务需要 Node.js 22.13+。请安装后设置 RONGXING_NODE 为 node 可执行文件路径。'); process.exit(1) }
const args = process.argv.includes('--test') ? ['node_modules/vitest/vitest.mjs', 'run', 'tests/maintenance-sync.test.ts']
  : process.argv[2] === '--timetable' ? ['--import', 'tsx', 'scripts/timetable-import.ts', ...process.argv.slice(3)]
  : ['--import', 'tsx', 'scripts/maintenance-serve.ts']
const result = spawnSync(node, args, { stdio: 'inherit', windowsHide: true })
if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
