export type RecordSource = 'manual' | 'import' | 'restore'

export interface MedicalRecord {
  id: number
  visitDate: string
  name: string
  gender: string | null
  ageRaw: string | null
  diagnosis: string | null
  clinicalManifestation: string | null
  treatment: string | null
  remark: string | null
  feeRaw: string | null
  createdAt: string
  updatedAt: string
  source: RecordSource
}

export type MedicalRecordInput = Omit<
  MedicalRecord,
  'id' | 'createdAt' | 'updatedAt' | 'source'
>

export interface RecordListQuery {
  page: number
  pageSize: number
  keyword?: string
  dateFrom?: string
  dateTo?: string
  gender?: string
}

export interface RecordListResult {
  rows: MedicalRecord[]
  total: number
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export type OperationType = 'create' | 'update' | 'delete' | 'import'

export interface OperationLog {
  id: number
  operationType: OperationType
  summary: string
  affectedCount: number
  createdAt: string
  undoneAt: string | null
  canUndo: boolean
  beforeData?: MedicalRecord[]
  afterData?: MedicalRecord[]
}

export type DuplicateKey = 'all' | 'date_name' | 'demographic' | 'recommended'
export type DuplicateAction = 'skip' | 'keep' | 'overwrite'

export interface ImportRow {
  rowNumber: number
  data: MedicalRecordInput
  status: 'valid' | 'warning' | 'error' | 'duplicate'
  messages: string[]
  duplicateId?: number
}

export interface ImportPreview {
  token: string
  fileName: string
  total: number
  valid: number
  warnings: number
  errors: number
  duplicates: number
  rows: ImportRow[]
}

export interface ImportCommitResult {
  imported: number
  skipped: number
  overwritten: number
}

export interface ExportResult {
  canceled: boolean
  filePath?: string
  count?: number
}

export interface AppSettings {
  tableDensity: 'compact' | 'comfortable'
  fontScale: 90 | 100 | 110 | 120
  defaultPageSize: 20 | 50 | 100
  duplicateKey: DuplicateKey
  visibleColumns: string[]
}

export interface ClinicApi {
  records: {
    list(query: RecordListQuery): Promise<RecordListResult>
    get(id: number): Promise<MedicalRecord | null>
    create(input: MedicalRecordInput): Promise<MedicalRecord>
    update(id: number, input: MedicalRecordInput): Promise<MedicalRecord>
    deleteBatch(ids: number[]): Promise<number>
  }
  operations: {
    list(): Promise<OperationLog[]>
    get(id: number): Promise<OperationLog | null>
    undo(): Promise<boolean>
    redo(): Promise<boolean>
    export(): Promise<ExportResult>
  }
  excel: {
    analyze(duplicateKey: DuplicateKey): Promise<ImportPreview | null>
    commit(token: string, duplicateAction: DuplicateAction): Promise<ImportCommitResult>
    exportRecords(query: RecordListQuery, selectedIds?: number[]): Promise<ExportResult>
  }
  backup: {
    create(): Promise<ExportResult>
    restore(): Promise<boolean>
  }
  settings: {
    get(): Promise<AppSettings>
    update(settings: AppSettings): Promise<AppSettings>
  }
  app: {
    getDataPath(): Promise<string>
  }
}
