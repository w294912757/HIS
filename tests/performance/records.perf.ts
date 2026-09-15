import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { performance } from 'node:perf_hooks'
import { closeDatabase, getDatabase } from '../../src/main/db/database'
import { listRecords } from '../../src/main/db/repository'

const directory = mkdtempSync(join(tmpdir(), 'clinic-performance-'))

function percentile95(values: number[]): number {
  return values.slice().sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1]
}

function measure(action: () => void, repetitions = 20): number {
  action()
  const durations: number[] = []
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now(); action(); durations.push(performance.now() - start)
  }
  return percentile95(durations)
}

beforeAll(() => {
  process.env.CLINIC_RECORDS_DATA_DIR = directory
  const db = getDatabase()
  const statement = db.prepare(`INSERT INTO medical_records (visit_date, name, gender, age_raw, diagnosis, clinical_manifestation, treatment, remark, fee_raw, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`)
  db.exec('BEGIN IMMEDIATE')
  const now = new Date().toISOString()
  for (let index = 0; index < 100_000; index++) {
    const day = String(index % 28 + 1).padStart(2, '0')
    statement.run(`2026-08-${day}`, `患者${index}`, index % 2 ? '男' : '女', String(index % 90), `诊断${index % 200}`, `表现${index % 50}`, `治疗方案${index % 100}`, index % 10 ? null : `备注${index}`, String(index % 500), now, now)
  }
  db.exec('COMMIT')
})

afterAll(() => {
  closeDatabase(); rmSync(directory, { recursive: true, force: true }); delete process.env.CLINIC_RECORDS_DATA_DIR
})

describe('十万条病历查询性能', () => {
  it('常用查询 P95 均低于 300ms', () => {
    const results = {
      firstPage: measure(() => { listRecords({ page: 1, pageSize: 50 }) }),
      keyword: measure(() => { listRecords({ page: 1, pageSize: 50, keyword: '患者99999' }) }),
      shortKeyword: measure(() => { listRecords({ page: 1, pageSize: 50, keyword: '患者' }) }),
      filters: measure(() => { listRecords({ page: 1, pageSize: 50, dateFrom: '2026-08-20', dateTo: '2026-08-28', gender: '男' }) })
    }
    console.info('P95 (ms)', results)
    expect(results.firstPage).toBeLessThan(300)
    expect(results.keyword).toBeLessThan(300)
    expect(results.shortKeyword).toBeLessThan(300)
    expect(results.filters).toBeLessThan(300)
  })
})
