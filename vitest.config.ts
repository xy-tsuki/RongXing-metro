import { defineConfig } from 'vitest/config'

// Core and ingestion tests run without the uni-app browser compiler or its HMR server.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
