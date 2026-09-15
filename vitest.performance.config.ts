import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/performance/**/*.perf.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['verbose']
  }
})
