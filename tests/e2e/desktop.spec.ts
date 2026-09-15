import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

test('Electron 通过 IPC 使用 SQLite 完成 CRUD', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'clinic-records-desktop-'))
  const app = await electron.launch({ args: ['.'], env: { ...process.env, CLINIC_RECORDS_DATA_DIR: dataDir } })
  try {
    const page = await app.firstWindow(); await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('record-table')).toBeVisible()
    await page.getByTestId('record-create-button').click()
    const drawer = page.getByRole('dialog', { name: '新增病历' })
    await drawer.getByLabel('姓名').fill('桌面测试')
    await drawer.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('桌面测试')).toBeVisible()
    await page.getByTestId('record-row-delete').click()
    await page.getByRole('button', { name: '确认删除' }).click()
    await expect(page.getByText('桌面测试')).toHaveCount(0)
    await expect(page.getByTestId('undo-button')).toHaveCount(0)
    await expect(page.getByTestId('redo-button')).toHaveCount(0)
  } finally {
    await app.close(); rmSync(dataDir, { recursive: true, force: true })
  }
})

test('浏览器开发模式和 Electron 读取同一个 SQLite 数据库', async ({ request }) => {
  await request.post('http://127.0.0.1:5173/__clinic_api', { data: { method: 'test:reset' } })
  const input = { visitDate: '2026-09-15', name: '跨模式共享', gender: '女', ageRaw: '35', diagnosis: '共享验证', clinicalManifestation: null, treatment: null, remark: null, feeRaw: '100' }
  await request.post('http://127.0.0.1:5173/__clinic_api', { data: { method: 'records:create', args: { input } } })
  const app = await electron.launch({ args: ['.'], env: { ...process.env, CLINIC_RECORDS_DATA_DIR: resolve('test-results', 'web-data') } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('跨模式共享')).toBeVisible()
    await expect(page.getByText('共享验证')).toBeVisible()
  } finally {
    await app.close()
  }
})
