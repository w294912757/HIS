import type { ClinicApi, DuplicateAction, ImportPreview } from '../../shared/types'

async function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch('/__clinic_api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })
  const result = await response.json() as { ok: boolean; data?: T; error?: string }
  if (!result.ok) throw new Error(result.error || '本地开发服务调用失败')
  return result.data as T
}

function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.dataset.testid = 'browser-file-input'; input.style.display = 'none'
    input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove() }, { once: true })
    document.body.appendChild(input); input.click()
  })
}

function download(bytes: Uint8Array, fileName: string, type: string): string {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return fileName
}

function decodeBase64(base64: string): Uint8Array {
  const text = atob(base64); const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index)
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let value = ''; const size = 0x8000
  for (let index = 0; index < bytes.length; index += size) value += String.fromCharCode(...bytes.subarray(index, index + size))
  return btoa(value)
}

type FilePayload = { base64: string; fileName: string; count?: number }
const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function createBrowserClinicApi(): ClinicApi {
  return {
    records: {
      list: (query) => rpc('records:list', { query }),
      get: (id) => rpc('records:get', { id }),
      create: (input) => rpc('records:create', { input }),
      update: (id, input) => rpc('records:update', { id, input }),
      deleteBatch: (ids) => rpc('records:delete-batch', { ids })
    },
    operations: {
      list: () => rpc('operations:list'),
      get: (id) => rpc('operations:get', { id }),
      undo: () => rpc('operations:undo'),
      redo: () => rpc('operations:redo'),
      async export() {
        const result = await rpc<FilePayload>('operations:export')
        download(decodeBase64(result.base64), result.fileName, excelMime)
        return { canceled: false, filePath: result.fileName, count: result.count }
      }
    },
    excel: {
      async analyze(key) {
        const file = await chooseFile('.xlsx')
        if (!file) return null
        return rpc<ImportPreview>('excel:analyze-upload', { base64: encodeBase64(new Uint8Array(await file.arrayBuffer())), fileName: file.name, key })
      },
      commit: (token, action: DuplicateAction) => rpc('excel:commit-token', { token, action }),
      async exportRecords(query, selectedIds) {
        const result = await rpc<FilePayload>('excel:export-records', { query, selectedIds })
        download(decodeBase64(result.base64), result.fileName, excelMime)
        return { canceled: false, filePath: result.fileName, count: result.count }
      }
    },
    backup: {
      async create() {
        const result = await rpc<FilePayload>('backup:create')
        download(decodeBase64(result.base64), result.fileName, 'application/octet-stream')
        return { canceled: false, filePath: result.fileName }
      },
      async restore() {
        const file = await chooseFile('.db')
        if (!file) return false
        return rpc('backup:restore', { base64: encodeBase64(new Uint8Array(await file.arrayBuffer())) })
      }
    },
    settings: {
      get: () => rpc('settings:get'),
      update: (settings) => rpc('settings:update', { settings })
    },
    app: { getDataPath: () => rpc('app:get-data-path') }
  }
}
