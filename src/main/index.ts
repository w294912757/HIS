import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeDatabase, getDataDirectory } from './db/database'
import { createRecord, deleteRecords, findRecords, getOperation, getRecord, getSettings, listOperations, listRecords, redoLastOperation, undoLastOperation, updateRecord, updateSettings } from './db/repository'
import type { AppSettings, DuplicateAction, DuplicateKey, MedicalRecordInput, RecordListQuery } from '../shared/types'
import { analyzeWorkbook, commitWorkbook, writeOperations, writeRecords } from './services/excel'
import { createAutomaticBackup, createBackup, restoreBackup } from './services/backup'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: true,
    backgroundColor: '#f4f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  ipcMain.handle('records:list', (_event, query: RecordListQuery) => listRecords(query))
  ipcMain.handle('records:get', (_event, id: number) => getRecord(id))
  ipcMain.handle('records:create', (_event, input: MedicalRecordInput) => createRecord(input))
  ipcMain.handle('records:update', (_event, id: number, input: MedicalRecordInput) => updateRecord(id, input))
  ipcMain.handle('records:delete-batch', (_event, ids: number[]) => {
    createAutomaticBackup('before-delete')
    return deleteRecords(ids)
  })
  ipcMain.handle('operations:list', () => listOperations())
  ipcMain.handle('operations:get', (_event, id: number) => getOperation(id))
  ipcMain.handle('operations:undo', () => undoLastOperation())
  ipcMain.handle('operations:redo', () => redoLastOperation())
  ipcMain.handle('operations:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, { title: '导出操作记录', defaultPath: `操作记录-${new Date().toISOString().slice(0, 10)}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    const operations = listOperations(); await writeOperations(result.filePath, operations)
    return { canceled: false, filePath: result.filePath, count: operations.length }
  })
  ipcMain.handle('excel:analyze', async (_event, duplicateKey: DuplicateKey) => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择病历 Excel', properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    return analyzeWorkbook(result.filePaths[0], duplicateKey)
  })
  ipcMain.handle('excel:commit', (_event, token: string, action: DuplicateAction) => {
    createAutomaticBackup('before-import')
    return commitWorkbook(token, action)
  })
  ipcMain.handle('excel:export-records', async (_event, query: RecordListQuery, selectedIds?: number[]) => {
    const result = await dialog.showSaveDialog(mainWindow!, { title: '导出病历', defaultPath: `病历导出-${new Date().toISOString().slice(0, 10)}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    const records = findRecords(query, selectedIds); await writeRecords(result.filePath, records)
    return { canceled: false, filePath: result.filePath, count: records.length }
  })
  ipcMain.handle('backup:create', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, { title: '备份数据库', defaultPath: `病历备份-${new Date().toISOString().slice(0, 10)}.db`, filters: [{ name: '数据库备份', extensions: ['db'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    createBackup(result.filePath); return { canceled: false, filePath: result.filePath }
  })
  ipcMain.handle('backup:restore', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: '恢复数据库备份', properties: ['openFile'], filters: [{ name: '数据库备份', extensions: ['db'] }] })
    if (result.canceled || !result.filePaths[0]) return false
    createAutomaticBackup('before-restore'); restoreBackup(result.filePaths[0]); return true
  })
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_event, settings: AppSettings) => updateSettings(settings))
  ipcMain.handle('app:get-data-path', () => getDataDirectory())
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    closeDatabase()
    if (process.platform !== 'darwin') app.quit()
  })
}
