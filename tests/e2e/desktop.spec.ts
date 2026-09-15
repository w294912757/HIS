import { expect, test, _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { spawn } from 'node:child_process'

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

test('Electron 主进程 bundle 可以导入并导出 Excel', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'clinic-records-excel-'))
  const inputPath = join(dataDir, 'input.xlsx')
  const outputPath = join(dataDir, 'output.xlsx')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('病历')
  sheet.addRow(['日期', '姓名', '性别', '年龄', '诊断', '临床表现', '治疗', '备注', '费用'])
  sheet.addRow(['2026-09-15', '桌面Excel测试', '女', '28', '导入诊断', '', '导入治疗', '', '120'])
  await workbook.xlsx.writeFile(inputPath)

  const app = await electron.launch({ args: ['.'], env: { ...process.env, CLINIC_RECORDS_DATA_DIR: dataDir } })
  try {
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [paths.inputPath] })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: paths.outputPath })) as typeof dialog.showSaveDialog
    }, { inputPath, outputPath })
    const page = await app.firstWindow()
    const preview = await page.evaluate(() => window.clinicApi!.excel.analyze('recommended'))
    expect(preview?.valid).toBe(1)
    const result = await page.evaluate((token) => window.clinicApi!.excel.commit(token, 'keep'), preview!.token)
    expect(result.imported).toBe(1)
    const exported = await page.evaluate(() => window.clinicApi!.excel.exportRecords({ page: 1, pageSize: 50 }))
    expect(exported.canceled).toBe(false)

    const exportedWorkbook = new ExcelJS.Workbook()
    await exportedWorkbook.xlsx.readFile(outputPath)
    expect(exportedWorkbook.worksheets[0].getRow(2).getCell(2).text).toBe('桌面Excel测试')
  } finally {
    await app.close(); rmSync(dataDir, { recursive: true, force: true })
  }
})

test('Electron 重复启动不会创建第二个业务实例', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'clinic-records-single-instance-'))
  const env = { ...process.env, CLINIC_RECORDS_DATA_DIR: dataDir }
  const app = await electron.launch({ args: ['.'], env })
  const second = spawn(resolve('node_modules/electron/dist/electron.exe'), ['.'], { cwd: resolve('.'), env })
  try {
    await app.firstWindow()
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => reject(new Error('第二个 Electron 实例未按预期退出')), 10_000)
      second.once('exit', (code) => { clearTimeout(timeout); resolveExit(code) })
    })
    expect(exitCode).toBe(0)
    expect(app.windows()).toHaveLength(1)
  } finally {
    if (second.exitCode === null) second.kill()
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
