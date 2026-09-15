import { getDatabase } from './database'
import type { AppSettings, MedicalRecord, MedicalRecordInput, OperationLog, OperationType, RecordListQuery, RecordListResult } from '../../shared/types'

type DbRow = { id: number; visit_date: string; name: string; gender: string | null; age_raw: string | null; diagnosis: string | null; clinical_manifestation: string | null; treatment: string | null; remark: string | null; fee_raw: string | null; created_at: string; updated_at: string; source: 'manual' | 'import' | 'restore' }
type OperationRow = { id: number; operation_type: OperationType; summary: string; affected_count: number; before_data: string | null; after_data: string | null; created_at: string; undone_at: string | null }

function mapRow(row: DbRow): MedicalRecord {
  return { id: row.id, visitDate: row.visit_date, name: row.name, gender: row.gender, ageRaw: row.age_raw, diagnosis: row.diagnosis, clinicalManifestation: row.clinical_manifestation, treatment: row.treatment, remark: row.remark, feeRaw: row.fee_raw, createdAt: row.created_at, updatedAt: row.updated_at, source: row.source }
}

export function normalizeInput(input: MedicalRecordInput): MedicalRecordInput {
  return { ...input, visitDate: input.visitDate.trim(), name: input.name.trim(), gender: input.gender?.trim() || null, ageRaw: input.ageRaw?.trim() || null, diagnosis: input.diagnosis?.trim() || null, clinicalManifestation: input.clinicalManifestation?.trim() || null, treatment: input.treatment?.trim() || null, remark: input.remark?.trim() || null, feeRaw: input.feeRaw?.trim() || null }
}

export function validateInput(input: MedicalRecordInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.visitDate)) throw new Error('日期必须使用 YYYY-MM-DD 格式')
  const [year, month, day] = input.visitDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('日期不是有效的日历日期')
  if (!input.name.trim()) throw new Error('姓名不能为空')
  if (input.name.length > 100) throw new Error('姓名不能超过 100 个字符')
  for (const [label, value, limit] of [
    ['年龄', input.ageRaw, 50], ['性别', input.gender, 20], ['诊断', input.diagnosis, 2000],
    ['临床表现', input.clinicalManifestation, 10000], ['治疗', input.treatment, 10000],
    ['备注', input.remark, 10000], ['费用', input.feeRaw, 200]
  ] as const) {
    if (value && value.length > limit) throw new Error(`${label}不能超过 ${limit} 个字符`)
  }
}

function runTransaction<T>(callback: () => T): T {
  const db = getDatabase(); db.exec('BEGIN IMMEDIATE')
  try { const result = callback(); db.exec('COMMIT'); return result } catch (error) { db.exec('ROLLBACK'); throw error }
}

function insertSnapshot(record: MedicalRecord): void {
  getDatabase().prepare(`INSERT OR REPLACE INTO medical_records (id, visit_date, name, gender, age_raw, diagnosis, clinical_manifestation, treatment, remark, fee_raw, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(record.id, record.visitDate, record.name, record.gender, record.ageRaw, record.diagnosis, record.clinicalManifestation, record.treatment, record.remark, record.feeRaw, record.createdAt, record.updatedAt, record.source)
}

function insertInput(input: MedicalRecordInput, source: MedicalRecord['source']): MedicalRecord {
  const value = normalizeInput(input); validateInput(value); const now = new Date().toISOString()
  const result = getDatabase().prepare(`INSERT INTO medical_records (visit_date, name, gender, age_raw, diagnosis, clinical_manifestation, treatment, remark, fee_raw, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(value.visitDate, value.name, value.gender, value.ageRaw, value.diagnosis, value.clinicalManifestation, value.treatment, value.remark, value.feeRaw, now, now, source)
  return getRecord(Number(result.lastInsertRowid))!
}

function addLog(type: OperationType, summary: string, before: MedicalRecord[] | null, after: MedicalRecord[] | null): void {
  getDatabase().prepare('DELETE FROM operation_logs WHERE undone_at IS NOT NULL').run()
  getDatabase().prepare(`INSERT INTO operation_logs (operation_type, summary, affected_count, before_data, after_data, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(type, summary, Math.max(before?.length || 0, after?.length || 0), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, new Date().toISOString())
}

function buildWhere(query: RecordListQuery): { clause: string; params: Record<string, string | number> } {
  const where: string[] = []; const params: Record<string, string | number> = {}
  if (query.keyword?.trim()) {
    where.push(`id IN (SELECT rowid FROM medical_records_fts WHERE search_text LIKE @keyword ESCAPE '\\')`)
    params.keyword = `%${query.keyword.trim().replace(/[\\%_]/g, '\\$&')}%`
  }
  if (query.dateFrom) { where.push('visit_date >= @dateFrom'); params.dateFrom = query.dateFrom }
  if (query.dateTo) { where.push('visit_date <= @dateTo'); params.dateTo = query.dateTo }
  if (query.gender) { where.push('gender = @gender'); params.gender = query.gender }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params }
}

export function listRecords(query: RecordListQuery): RecordListResult {
  const db = getDatabase(); const { clause, params } = buildWhere(query)
  const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM medical_records ${clause}`).get(params) as { count: number }).count)
  const page = Math.max(1, query.page); const pageSize = Math.min(200, Math.max(1, query.pageSize))
  const rows = db.prepare(`SELECT * FROM medical_records ${clause} ORDER BY visit_date DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as unknown as DbRow[]
  return { rows: rows.map(mapRow), total }
}

export function findRecords(query: RecordListQuery, selectedIds?: number[]): MedicalRecord[] {
  const db = getDatabase()
  if (selectedIds?.length) { const clean = [...new Set(selectedIds)]; const placeholders = clean.map(() => '?').join(','); return (db.prepare(`SELECT * FROM medical_records WHERE id IN (${placeholders}) ORDER BY visit_date DESC, id DESC`).all(...clean) as unknown as DbRow[]).map(mapRow) }
  const { clause, params } = buildWhere(query)
  return (db.prepare(`SELECT * FROM medical_records ${clause} ORDER BY visit_date DESC, id DESC`).all(params) as unknown as DbRow[]).map(mapRow)
}

export function getRecord(id: number): MedicalRecord | null {
  const row = getDatabase().prepare('SELECT * FROM medical_records WHERE id = ?').get(id) as unknown as DbRow | undefined
  return row ? mapRow(row) : null
}

export function createRecord(input: MedicalRecordInput): MedicalRecord {
  return runTransaction(() => { const record = insertInput(input, 'manual'); addLog('create', `新增病历：${record.name}`, null, [record]); return record })
}

export function updateRecord(id: number, rawInput: MedicalRecordInput): MedicalRecord {
  return runTransaction(() => {
    const before = getRecord(id); if (!before) throw new Error('病历不存在或已被删除')
    const input = normalizeInput(rawInput); validateInput(input); const now = new Date().toISOString()
    getDatabase().prepare(`UPDATE medical_records SET visit_date=?, name=?, gender=?, age_raw=?, diagnosis=?, clinical_manifestation=?, treatment=?, remark=?, fee_raw=?, updated_at=? WHERE id=?`)
      .run(input.visitDate, input.name, input.gender, input.ageRaw, input.diagnosis, input.clinicalManifestation, input.treatment, input.remark, input.feeRaw, now, id)
    const after = getRecord(id)!; addLog('update', `编辑病历：${after.name}`, [before], [after]); return after
  })
}

export function deleteRecords(ids: number[]): number {
  const cleanIds = [...new Set(ids.filter(Number.isInteger))]; if (!cleanIds.length) return 0
  return runTransaction(() => {
    const placeholders = cleanIds.map(() => '?').join(',')
    const before = (getDatabase().prepare(`SELECT * FROM medical_records WHERE id IN (${placeholders})`).all(...cleanIds) as unknown as DbRow[]).map(mapRow)
    if (!before.length) return 0
    const changes = Number(getDatabase().prepare(`DELETE FROM medical_records WHERE id IN (${placeholders})`).run(...cleanIds).changes)
    addLog('delete', `删除 ${changes} 条病历`, before, null); return changes
  })
}

export function importRecords(rows: Array<{ data: MedicalRecordInput; duplicateId?: number; duplicate?: boolean }>, action: 'skip' | 'keep' | 'overwrite'): { imported: number; skipped: number; overwritten: number } {
  return runTransaction(() => {
    const before: MedicalRecord[] = []; const after: MedicalRecord[] = []; let skipped = 0; let overwritten = 0
    for (const row of rows) {
      if (row.duplicate && action === 'skip') { skipped++; continue }
      if (row.duplicateId && action === 'overwrite') {
        const old = getRecord(row.duplicateId); if (old) before.push(old)
        const input = normalizeInput(row.data); validateInput(input); const now = new Date().toISOString()
        getDatabase().prepare(`UPDATE medical_records SET visit_date=?, name=?, gender=?, age_raw=?, diagnosis=?, clinical_manifestation=?, treatment=?, remark=?, fee_raw=?, updated_at=?, source='import' WHERE id=?`)
          .run(input.visitDate, input.name, input.gender, input.ageRaw, input.diagnosis, input.clinicalManifestation, input.treatment, input.remark, input.feeRaw, now, row.duplicateId)
        after.push(getRecord(row.duplicateId)!); overwritten++
      } else after.push(insertInput(row.data, 'import'))
    }
    if (after.length) addLog('import', `导入 ${after.length} 条病历`, before.length ? before : null, after)
    return { imported: after.length - overwritten, skipped, overwritten }
  })
}

export function listOperations(): OperationLog[] {
  const rows = getDatabase().prepare('SELECT * FROM operation_logs ORDER BY id DESC LIMIT 500').all() as unknown as OperationRow[]
  return rows.map((row) => ({
    id: row.id, operationType: row.operation_type, summary: row.summary,
    affectedCount: row.affected_count, createdAt: row.created_at, undoneAt: row.undone_at,
    canUndo: !row.undone_at
  }))
}

export function getOperation(id: number): OperationLog | null {
  const row = getDatabase().prepare('SELECT * FROM operation_logs WHERE id = ?').get(id) as unknown as OperationRow | undefined
  if (!row) return null
  return {
    id: row.id, operationType: row.operation_type, summary: row.summary,
    affectedCount: row.affected_count, createdAt: row.created_at, undoneAt: row.undone_at,
    canUndo: !row.undone_at,
    beforeData: row.before_data ? JSON.parse(row.before_data) as MedicalRecord[] : [],
    afterData: row.after_data ? JSON.parse(row.after_data) as MedicalRecord[] : []
  }
}

export function undoLastOperation(): boolean {
  const row = getDatabase().prepare('SELECT * FROM operation_logs WHERE undone_at IS NULL ORDER BY id DESC LIMIT 1').get() as unknown as OperationRow | undefined
  if (!row) return false
  return runTransaction(() => {
    const before = row.before_data ? JSON.parse(row.before_data) as MedicalRecord[] : []; const after = row.after_data ? JSON.parse(row.after_data) as MedicalRecord[] : []
    if (row.operation_type === 'create') for (const record of after) getDatabase().prepare('DELETE FROM medical_records WHERE id=?').run(record.id)
    else if (row.operation_type === 'delete' || row.operation_type === 'update') for (const record of before) insertSnapshot(record)
    else if (row.operation_type === 'import') { for (const record of after) getDatabase().prepare('DELETE FROM medical_records WHERE id=?').run(record.id); for (const record of before) insertSnapshot(record) }
    getDatabase().prepare('UPDATE operation_logs SET undone_at=? WHERE id=?').run(new Date().toISOString(), row.id); return true
  })
}

export function redoLastOperation(): boolean {
  const row = getDatabase().prepare('SELECT * FROM operation_logs WHERE undone_at IS NOT NULL ORDER BY undone_at DESC LIMIT 1').get() as unknown as OperationRow | undefined
  if (!row) return false
  return runTransaction(() => {
    const before = row.before_data ? JSON.parse(row.before_data) as MedicalRecord[] : []; const after = row.after_data ? JSON.parse(row.after_data) as MedicalRecord[] : []
    if (row.operation_type === 'delete') for (const record of before) getDatabase().prepare('DELETE FROM medical_records WHERE id=?').run(record.id)
    else for (const record of after) insertSnapshot(record)
    getDatabase().prepare('UPDATE operation_logs SET undone_at=NULL WHERE id=?').run(row.id); return true
  })
}

export function findDuplicate(input: MedicalRecordInput, key: string): number | undefined {
  const db = getDatabase(); let row: { id: number } | undefined
  if (key === 'date_name') row = db.prepare('SELECT id FROM medical_records WHERE visit_date=? AND name=? LIMIT 1').get(input.visitDate, input.name) as { id: number } | undefined
  else if (key === 'demographic') row = db.prepare(`SELECT id FROM medical_records WHERE visit_date=? AND name=? AND COALESCE(gender,'')=COALESCE(?,'') AND COALESCE(age_raw,'')=COALESCE(?,'') LIMIT 1`).get(input.visitDate, input.name, input.gender, input.ageRaw) as { id: number } | undefined
  else if (key === 'all') row = db.prepare(`SELECT id FROM medical_records WHERE visit_date=? AND name=? AND COALESCE(gender,'')=COALESCE(?,'') AND COALESCE(age_raw,'')=COALESCE(?,'') AND COALESCE(diagnosis,'')=COALESCE(?,'') AND COALESCE(clinical_manifestation,'')=COALESCE(?,'') AND COALESCE(treatment,'')=COALESCE(?,'') AND COALESCE(remark,'')=COALESCE(?,'') AND COALESCE(fee_raw,'')=COALESCE(?,'') LIMIT 1`).get(input.visitDate, input.name, input.gender, input.ageRaw, input.diagnosis, input.clinicalManifestation, input.treatment, input.remark, input.feeRaw) as { id: number } | undefined
  else row = db.prepare(`SELECT id FROM medical_records WHERE visit_date=? AND name=? AND COALESCE(gender,'')=COALESCE(?,'') AND COALESCE(age_raw,'')=COALESCE(?,'') AND COALESCE(diagnosis,'')=COALESCE(?,'') LIMIT 1`).get(input.visitDate, input.name, input.gender, input.ageRaw, input.diagnosis) as { id: number } | undefined
  return row?.id
}

const optionalColumns = ['gender', 'ageRaw', 'diagnosis', 'clinicalManifestation', 'treatment', 'remark', 'feeRaw']
const defaultSettings: AppSettings = { tableDensity: 'comfortable', fontScale: 100, defaultPageSize: 50, duplicateKey: 'recommended', visibleColumns: [...optionalColumns] }

export function getSettings(): AppSettings {
  const row = getDatabase().prepare('SELECT value FROM app_settings WHERE key = ?').get('preferences') as { value: string } | undefined
  if (!row) return { ...defaultSettings }
  try { return { ...defaultSettings, ...JSON.parse(row.value) as Partial<AppSettings> } } catch { return { ...defaultSettings } }
}

export function updateSettings(settings: AppSettings): AppSettings {
  const valid: AppSettings = {
    tableDensity: settings.tableDensity === 'compact' ? 'compact' : 'comfortable',
    fontScale: [90, 100, 110, 120].includes(settings.fontScale) ? settings.fontScale : 100,
    defaultPageSize: [20, 50, 100].includes(settings.defaultPageSize) ? settings.defaultPageSize : 50,
    duplicateKey: ['all', 'date_name', 'demographic', 'recommended'].includes(settings.duplicateKey) ? settings.duplicateKey : 'recommended',
    visibleColumns: Array.isArray(settings.visibleColumns) ? settings.visibleColumns.filter((column) => optionalColumns.includes(column)) : [...optionalColumns]
  }
  getDatabase().prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('preferences', JSON.stringify(valid))
  return valid
}
