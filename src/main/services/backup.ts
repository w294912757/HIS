import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { closeDatabase, getDatabase, getDataDirectory } from '../db/database'

export function databasePath(): string {
  return join(getDataDirectory(), 'clinic-records.db')
}

export function createBackup(filePath: string): void {
  mkdirSync(getDataDirectory(), { recursive: true })
  getDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE);')
  copyFileSync(databasePath(), filePath)
}

export function createAutomaticBackup(reason: string): string {
  const directory = join(getDataDirectory(), 'backups')
  mkdirSync(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(directory, `${stamp}-${reason}.db`)
  createBackup(target)
  const backups = readdirSync(directory).filter((name) => name.endsWith('.db')).sort().reverse()
  for (const expired of backups.slice(20)) unlinkSync(join(directory, expired))
  return target
}

export function restoreBackup(filePath: string): void {
  if (!existsSync(filePath)) throw new Error('备份文件不存在')
  let candidate: DatabaseSync | null = null
  try {
    candidate = new DatabaseSync(filePath, { readOnly: true })
    const result = candidate.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    const table = candidate.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='medical_records'").get()
    if (result.integrity_check !== 'ok' || !table) throw new Error('备份数据库不完整或不是有效的病历备份')
  } catch (error) {
    throw error instanceof Error && error.message.includes('病历备份') ? error : new Error('备份数据库不完整或无法读取')
  } finally {
    candidate?.close()
  }
  closeDatabase()
  copyFileSync(filePath, databasePath())
  getDatabase()
}
