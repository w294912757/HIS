import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeDatabase, getDatabase } from '../../src/main/db/database'
import { createRecord, deleteRecords, getRecord, getSettings, listRecords, redoLastOperation, undoLastOperation, updateRecord, updateSettings } from '../../src/main/db/repository'
import { createBackup, restoreBackup } from '../../src/main/services/backup'

const directory = mkdtempSync(join(tmpdir(), 'clinic-repository-'))
const input = { visitDate: '2026-09-15', name: '张三', gender: '男', ageRaw: '32', diagnosis: '测试', clinicalManifestation: null, treatment: null, remark: null, feeRaw: '100-80' }

beforeAll(() => { process.env.CLINIC_RECORDS_DATA_DIR = directory })
beforeEach(() => { getDatabase().exec('DELETE FROM operation_logs; DELETE FROM medical_records; DELETE FROM app_settings;') })
afterAll(() => { closeDatabase(); rmSync(directory, { recursive: true, force: true }); delete process.env.CLINIC_RECORDS_DATA_DIR })

describe('SQLite Repository', () => {
  it('执行版本化迁移并分页查询', () => {
    expect((getDatabase().prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    createRecord(input); createRecord({ ...input, name: '李四' })
    const result = listRecords({ page: 1, pageSize: 1, keyword: '测试' })
    expect(result.total).toBe(2)
    expect(result.rows).toHaveLength(1)
  })

  it('按日期、性别、年龄和费用查询并转义通配符', () => {
    createRecord({ ...input, name: '百分号%患者', ageRaw: '2岁10个月', feeRaw: '100-80' })
    createRecord({ ...input, visitDate: '2026-08-01', name: '其他患者', gender: '女', ageRaw: '40', feeRaw: '300' })
    expect(listRecords({ page: 1, pageSize: 50, keyword: '%' }).total).toBe(1)
    expect(listRecords({ page: 1, pageSize: 50, keyword: '2岁10个月' }).total).toBe(1)
    expect(listRecords({ page: 1, pageSize: 50, keyword: '100-80' }).total).toBe(1)
    expect(listRecords({ page: 1, pageSize: 50, dateFrom: '2026-09-01', gender: '男' }).total).toBe(1)
  })

  it('新增、编辑、删除均可撤销和重做', () => {
    const created = createRecord(input)
    expect(undoLastOperation()).toBe(true)
    expect(getRecord(created.id)).toBeNull()
    expect(redoLastOperation()).toBe(true)
    expect(getRecord(created.id)?.name).toBe('张三')

    updateRecord(created.id, { ...input, diagnosis: '更新后' })
    expect(undoLastOperation()).toBe(true)
    expect(getRecord(created.id)?.diagnosis).toBe('测试')
    expect(redoLastOperation()).toBe(true)
    expect(getRecord(created.id)?.diagnosis).toBe('更新后')

    deleteRecords([created.id])
    expect(getRecord(created.id)).toBeNull()
    expect(undoLastOperation()).toBe(true)
    expect(getRecord(created.id)?.name).toBe('张三')
    expect(redoLastOperation()).toBe(true)
    expect(getRecord(created.id)).toBeNull()
  })

  it('撤销后产生新操作会清除失效的重做分支', () => {
    createRecord(input)
    expect(undoLastOperation()).toBe(true)
    createRecord({ ...input, name: '新分支' })
    expect(redoLastOperation()).toBe(false)
  })

  it('持久化并校验显示设置', () => {
    const saved = updateSettings({ tableDensity: 'compact', fontScale: 110, defaultPageSize: 100, duplicateKey: 'all', visibleColumns: ['diagnosis', 'feeRaw'] })
    expect(saved.tableDensity).toBe('compact')
    expect(getSettings()).toEqual(saved)
  })

  it('备份可恢复且拒绝无效数据库', () => {
    const created = createRecord(input)
    const backup = join(directory, 'valid.db'); createBackup(backup)
    deleteRecords([created.id]); restoreBackup(backup)
    expect(getRecord(created.id)?.name).toBe('张三')
    const invalid = join(directory, 'invalid.db'); writeFileSync(invalid, 'not sqlite')
    expect(() => restoreBackup(invalid)).toThrow('备份数据库不完整')
    expect(getRecord(created.id)?.name).toBe('张三')
  })
})
