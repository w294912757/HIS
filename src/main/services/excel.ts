import ExcelJS from 'exceljs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DuplicateAction, DuplicateKey, ImportCommitResult, ImportPreview, ImportRow, MedicalRecord, MedicalRecordInput, OperationLog } from '../../shared/types'
import { findDuplicate, importRecords, validateInput } from '../db/repository'

const headers = ['日期', '姓名', '性别', '年龄', '诊断', '临床表现', '治疗', '备注', '费用'] as const
const previews = new Map<string, ImportPreview>()

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') {
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if ('text' in value) return value.text.trim() || null
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue)
    if ('richText' in value) return value.richText.map((item) => item.text).join('').trim() || null
  }
  return String(value).trim() || null
}

function excelDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'number') {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }
  const text = cellText(value)
  if (!text) return null
  const normalized = text.replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '').trim()
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function signature(input: MedicalRecordInput, key: DuplicateKey): string {
  if (key === 'date_name') return [input.visitDate, input.name].join('|')
  if (key === 'demographic') return [input.visitDate, input.name, input.gender, input.ageRaw].join('|')
  if (key === 'all') return Object.values(input).join('|')
  return [input.visitDate, input.name, input.gender, input.ageRaw, input.diagnosis].join('|')
}

export async function analyzeWorkbook(filePath: string, duplicateKey: DuplicateKey, displayName?: string): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Excel 中没有可读取的工作表')
  const positions = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, col) => positions.set(cellText(cell.value) || '', col))
  const missing = ['日期', '姓名'].filter((name) => !positions.has(name))
  if (missing.length) throw new Error(`缺少必填表头：${missing.join('、')}`)

  const seen = new Set<string>()
  const rows: ImportRow[] = []
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    if (!row.hasValues) continue
    const value = (name: string): ExcelJS.CellValue => row.getCell(positions.get(name) || 0).value
    const data: MedicalRecordInput = {
      visitDate: excelDate(value('日期')) || '',
      name: cellText(value('姓名')) || '',
      gender: cellText(value('性别')),
      ageRaw: cellText(value('年龄')),
      diagnosis: cellText(value('诊断')),
      clinicalManifestation: cellText(value('临床表现')),
      treatment: cellText(value('治疗')),
      remark: cellText(value('备注')),
      feeRaw: cellText(value('费用'))
    }
    const messages: string[] = []
    let status: ImportRow['status'] = 'valid'
    try { validateInput(data) } catch (error) { status = 'error'; messages.push(error instanceof Error ? error.message : '数据无效') }
    if (data.gender && !['男', '女', '未知', '其他'].includes(data.gender)) { if (status === 'valid') status = 'warning'; messages.push('性别不是常见值') }
    if (data.ageRaw && !/^\d+(?:[.,]\d+)?(?:岁|月|天)?(?:\d+个月)?$/.test(data.ageRaw)) { if (status === 'valid') status = 'warning'; messages.push('年龄格式不常见，仍将保留原文') }
    if (data.feeRaw && !/^\d+(?:\.\d+)?$/.test(data.feeRaw)) { if (status === 'valid') status = 'warning'; messages.push('费用不是单一金额，仍将保留原文') }
    const key = signature(data, duplicateKey)
    const duplicateId = status !== 'error' ? findDuplicate(data, duplicateKey) : undefined
    if (status !== 'error' && (duplicateId || seen.has(key))) { status = 'duplicate'; messages.push(duplicateId ? '与现有病历重复' : '与本次文件中的其他行重复') }
    seen.add(key)
    rows.push({ rowNumber, data, status, messages, duplicateId })
  }
  const token = randomUUID()
  const preview: ImportPreview = {
    token, fileName: displayName || basename(filePath), total: rows.length,
    valid: rows.filter((row) => row.status === 'valid').length,
    warnings: rows.filter((row) => row.status === 'warning').length,
    errors: rows.filter((row) => row.status === 'error').length,
    duplicates: rows.filter((row) => row.status === 'duplicate').length,
    rows
  }
  previews.set(token, preview)
  return preview
}

export function commitWorkbook(token: string, action: DuplicateAction): ImportCommitResult {
  const preview = previews.get(token)
  if (!preview) throw new Error('导入预览已失效，请重新选择文件')
  const eligible = preview.rows.filter((row) => row.status !== 'error')
  const result = importRecords(eligible.map((row) => ({ data: row.data, duplicateId: row.duplicateId, duplicate: row.status === 'duplicate' })), action)
  previews.delete(token)
  return result
}

export async function writeRecords(filePath: string, records: MedicalRecord[]): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('病例汇总')
  sheet.addRow(headers)
  for (const record of records) sheet.addRow([record.visitDate, record.name, record.gender, record.ageRaw, record.diagnosis, record.clinicalManifestation, record.treatment, record.remark, record.feeRaw])
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = { from: 'A1', to: 'I1' }
  sheet.columns = [{ width: 13 }, { width: 12 }, { width: 8 }, { width: 10 }, { width: 22 }, { width: 28 }, { width: 36 }, { width: 24 }, { width: 14 }]
  await workbook.xlsx.writeFile(filePath)
}

export async function writeOperations(filePath: string, operations: OperationLog[]): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('操作记录')
  sheet.addRow(['时间', '操作', '摘要', '影响数量', '状态'])
  for (const item of operations) sheet.addRow([item.createdAt, item.operationType, item.summary, item.affectedCount, item.undoneAt ? '已回退' : '有效'])
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.columns = [{ width: 26 }, { width: 14 }, { width: 38 }, { width: 12 }, { width: 12 }]
  await workbook.xlsx.writeFile(filePath)
}
