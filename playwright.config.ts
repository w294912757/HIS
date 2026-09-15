import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, CLINIC_RECORDS_TEST_MODE: '1', CLINIC_RECORDS_DATA_DIR: resolve(process.cwd(), 'test-results', 'web-data') }
  },
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'web', testMatch: /(?:web|visual)\.spec\.ts/, use: { baseURL: 'http://127.0.0.1:5173', headless: true, viewport: { width: 1366, height: 768 } } },
    { name: 'desktop', testMatch: /desktop\.spec\.ts/ }
  ],
  outputDir: 'test-results/artifacts'
})
