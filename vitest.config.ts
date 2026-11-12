import { defineConfig } from 'vitest/config'

// Core and ingestion tests run without the uni-app browser compiler or its HMR server.
// 会话、发布包等集成测试要在真实线网上连续做多次完整规划（每次约 0.5 秒），
// 单独运行 4–6 秒；全量并发运行时争抢 CPU 会越过默认 5 秒。单个用例超时放宽到 20 秒。
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 20_000 } })
