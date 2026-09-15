import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

let database: DatabaseSync | null = null

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS medical_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visit_date TEXT NOT NULL,
        name TEXT NOT NULL,
        gender TEXT,
        age_raw TEXT,
        diagnosis TEXT,
        clinical_manifestation TEXT,
        treatment TEXT,
        remark TEXT,
        fee_raw TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual'
      );
      CREATE INDEX IF NOT EXISTS idx_medical_records_visit_date ON medical_records(visit_date);
      CREATE INDEX IF NOT EXISTS idx_medical_records_name ON medical_records(name);
      CREATE INDEX IF NOT EXISTS idx_medical_records_gender ON medical_records(gender);
      CREATE INDEX IF NOT EXISTS idx_medical_records_diagnosis ON medical_records(diagnosis);
      CREATE INDEX IF NOT EXISTS idx_medical_records_date_name ON medical_records(visit_date, name);
      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        affected_count INTEGER NOT NULL,
        before_data TEXT,
        after_data TEXT,
        created_at TEXT NOT NULL,
        undone_at TEXT,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    version: 2,
    sql: `
      CREATE VIRTUAL TABLE IF NOT EXISTS medical_records_fts USING fts5(search_text, tokenize='trigram');
      INSERT INTO medical_records_fts(rowid, search_text)
        SELECT id, COALESCE(name,'') || char(31) || COALESCE(age_raw,'') || char(31) ||
          COALESCE(diagnosis,'') || char(31) || COALESCE(clinical_manifestation,'') || char(31) ||
          COALESCE(treatment,'') || char(31) || COALESCE(remark,'') || char(31) || COALESCE(fee_raw,'')
        FROM medical_records
        WHERE id NOT IN (SELECT rowid FROM medical_records_fts);
      CREATE TRIGGER IF NOT EXISTS medical_records_fts_insert AFTER INSERT ON medical_records BEGIN
        INSERT INTO medical_records_fts(rowid, search_text) VALUES (
          new.id, COALESCE(new.name,'') || char(31) || COALESCE(new.age_raw,'') || char(31) ||
          COALESCE(new.diagnosis,'') || char(31) || COALESCE(new.clinical_manifestation,'') || char(31) ||
          COALESCE(new.treatment,'') || char(31) || COALESCE(new.remark,'') || char(31) || COALESCE(new.fee_raw,'')
        );
      END;
      CREATE TRIGGER IF NOT EXISTS medical_records_fts_delete AFTER DELETE ON medical_records BEGIN
        DELETE FROM medical_records_fts WHERE rowid = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS medical_records_fts_update AFTER UPDATE ON medical_records BEGIN
        DELETE FROM medical_records_fts WHERE rowid = old.id;
        INSERT INTO medical_records_fts(rowid, search_text) VALUES (
          new.id, COALESCE(new.name,'') || char(31) || COALESCE(new.age_raw,'') || char(31) ||
          COALESCE(new.diagnosis,'') || char(31) || COALESCE(new.clinical_manifestation,'') || char(31) ||
          COALESCE(new.treatment,'') || char(31) || COALESCE(new.remark,'') || char(31) || COALESCE(new.fee_raw,'')
        );
      END;
    `
  }
] as const

function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  for (const migration of migrations) {
    if (migration.version <= current) continue
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function getDataDirectory(): string {
  const configured = process.env.CLINIC_RECORDS_DATA_DIR
  if (configured) return configured
  const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd()
  return join(localAppData, 'ClinicRecords', 'data')
}

export function getDatabase(): DatabaseSync {
  if (database) return database

  const dataDirectory = getDataDirectory()
  mkdirSync(dataDirectory, { recursive: true })
  database = new DatabaseSync(join(dataDirectory, 'clinic-records.db'))
  database.exec('PRAGMA journal_mode = WAL;')
  database.exec('PRAGMA foreign_keys = ON;')
  migrate(database)
  return database
}

export function closeDatabase(): void {
  database?.close()
  database = null
}
