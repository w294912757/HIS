import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ClinicApi, DuplicateAction, DuplicateKey, MedicalRecordInput, RecordListQuery } from '../shared/types'

const api: ClinicApi = {
  records: {
    list: (query: RecordListQuery) => ipcRenderer.invoke('records:list', query),
    get: (id: number) => ipcRenderer.invoke('records:get', id),
    create: (input: MedicalRecordInput) => ipcRenderer.invoke('records:create', input),
    update: (id: number, input: MedicalRecordInput) => ipcRenderer.invoke('records:update', id, input),
    deleteBatch: (ids: number[]) => ipcRenderer.invoke('records:delete-batch', ids)
  },
  operations: {
    list: () => ipcRenderer.invoke('operations:list'),
    get: (id: number) => ipcRenderer.invoke('operations:get', id),
    undo: () => ipcRenderer.invoke('operations:undo'),
    redo: () => ipcRenderer.invoke('operations:redo'),
    export: () => ipcRenderer.invoke('operations:export')
  },
  excel: {
    analyze: (duplicateKey: DuplicateKey) => ipcRenderer.invoke('excel:analyze', duplicateKey),
    commit: (token: string, duplicateAction: DuplicateAction) => ipcRenderer.invoke('excel:commit', token, duplicateAction),
    exportRecords: (query: RecordListQuery, selectedIds?: number[]) => ipcRenderer.invoke('excel:export-records', query, selectedIds)
  },
  backup: {
    create: () => ipcRenderer.invoke('backup:create'),
    restore: () => ipcRenderer.invoke('backup:restore')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: AppSettings) => ipcRenderer.invoke('settings:update', settings)
  },
  app: {
    getDataPath: () => ipcRenderer.invoke('app:get-data-path')
  }
}

contextBridge.exposeInMainWorld('clinicApi', api)
