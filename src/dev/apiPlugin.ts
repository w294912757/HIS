import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRecord, deleteRecords, findRecords, getOperation, getRecord, getSettings, listOperations, listRecords, redoLastOperation, undoLastOperation, updateRecord, updateSettings } from '../main/db/repository'
import { closeDatabase, getDatabase, getDataDirectory } from '../main/db/database'
import { createAutomaticBackup, createBackup, restoreBackup } from '../main/services/backup'
import { analyzeWorkbook, commitWorkbook, writeOperations, writeRecords } from '../main/services/excel'
import type { AppSettings, DuplicateAction, DuplicateKey, MedicalRecordInput, RecordListQuery } from '../shared/types'

type RpcRequest = { method: string; args?: Record<string, unknown> }

async function readJson(request: IncomingMessage): Promise<RpcRequest> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); size += buffer.length
    if (size > 50 * 1024 * 1024) throw new Error('请求数据超过 50MB 限制')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcRequest
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

async function dispatch(request: RpcRequest): Promise<unknown> {
  const args = request.args || {}
  switch (request.method) {
    case 'records:list': return listRecords(args.query as RecordListQuery)
    case 'records:find': return findRecords(args.query as RecordListQuery, args.selectedIds as number[] | undefined)
    case 'records:get': return getRecord(args.id as number)
    case 'records:create': return createRecord(args.input as MedicalRecordInput)
    case 'records:update': return updateRecord(args.id as number, args.input as MedicalRecordInput)
    case 'records:delete-batch': createAutomaticBackup('before-delete'); return deleteRecords(args.ids as number[])
    case 'operations:list': return listOperations()
    case 'operations:get': return getOperation(args.id as number)
    case 'operations:undo': return undoLastOperation()
    case 'operations:redo': return redoLastOperation()
    case 'excel:analyze-upload': {
      const target = join(getDataDirectory(), `${randomUUID()}.xlsx`)
      writeFileSync(target, Buffer.from(args.base64 as string, 'base64'))
      try { return await analyzeWorkbook(target, args.key as DuplicateKey, args.fileName as string) } finally { unlinkSync(target) }
    }
    case 'excel:commit-token': createAutomaticBackup('before-import'); return commitWorkbook(args.token as string, args.action as DuplicateAction)
    case 'excel:export-records': {
      const records = findRecords(args.query as RecordListQuery, args.selectedIds as number[] | undefined)
      const target = join(getDataDirectory(), `${randomUUID()}.xlsx`)
      try { await writeRecords(target, records); return { base64: readFileSync(target).toString('base64'), fileName: `病历导出-${new Date().toISOString().slice(0, 10)}.xlsx`, count: records.length } } finally { try { unlinkSync(target) } catch { /* 文件未创建 */ } }
    }
    case 'operations:export': {
      const operations = listOperations(); const target = join(getDataDirectory(), `${randomUUID()}.xlsx`)
      try { await writeOperations(target, operations); return { base64: readFileSync(target).toString('base64'), fileName: `操作记录-${new Date().toISOString().slice(0, 10)}.xlsx`, count: operations.length } } finally { try { unlinkSync(target) } catch { /* 文件未创建 */ } }
    }
    case 'backup:create': {
      const target = join(getDataDirectory(), 'browser-download.db'); createBackup(target)
      const base64 = readFileSync(target).toString('base64'); unlinkSync(target)
      return { base64, fileName: `病历备份-${new Date().toISOString().slice(0, 10)}.db` }
    }
    case 'backup:restore': {
      createAutomaticBackup('before-restore')
      const target = join(getDataDirectory(), 'browser-upload.db'); writeFileSync(target, Buffer.from(args.base64 as string, 'base64'))
      try { restoreBackup(target) } finally { unlinkSync(target) }
      return true
    }
    case 'app:get-data-path': return getDataDirectory()
    case 'settings:get': return getSettings()
    case 'settings:update': return updateSettings(args.settings as AppSettings)
    case 'test:reset': {
      if (process.env.CLINIC_RECORDS_TEST_MODE !== '1') throw new Error('测试接口未启用')
      const db = getDatabase(); db.exec('DELETE FROM operation_logs; DELETE FROM medical_records; DELETE FROM app_settings;')
      return true
    }
    default: throw new Error(`未知接口：${request.method}`)
  }
}

export function clinicDevApiPlugin(): Plugin {
  return {
    name: 'clinic-dev-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__clinic_api') return next()
        if (request.method !== 'POST') return json(response, 405, { ok: false, error: '仅支持 POST' })
        try { json(response, 200, { ok: true, data: await dispatch(await readJson(request)) }) }
        catch (error) { json(response, 400, { ok: false, error: error instanceof Error ? error.message : '开发服务调用失败' }) }
      })
      server.httpServer?.once('close', () => closeDatabase())
    }
  }
}
