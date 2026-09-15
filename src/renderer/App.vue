<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, EditPen, MoreFilled, Plus, Upload, View } from '@element-plus/icons-vue'
import type { AppSettings, DuplicateAction, DuplicateKey, ImportPreview, MedicalRecord, MedicalRecordInput, OperationLog } from '../shared/types'
import { clinicApi } from './api'

const loading = ref(false)
const saving = ref(false)
const nameInput = ref<{ focus: () => void } | null>(null)
const drawerVisible = ref(false)
const detailVisible = ref(false)
const detailRecord = ref<MedicalRecord | null>(null)
const editingId = ref<number | null>(null)
const rows = ref<MedicalRecord[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const dataPath = ref('')
const importVisible = ref(false)
const importLoading = ref(false)
const importPreview = ref<ImportPreview | null>(null)
const duplicateKey = ref<DuplicateKey>('recommended')
const duplicateAction = ref<DuplicateAction>('skip')
const operationVisible = ref(false)
const operations = ref<OperationLog[]>([])
const operationDetails = reactive<Record<number, OperationLog>>({})
const operationKeyword = ref('')
const operationType = ref('')
const settingsVisible = ref(false)
const unsavedConfirmVisible = ref(false)
const pendingEditorClose = ref<(() => void) | undefined>()
const settings = reactive<AppSettings>({ tableDensity: 'comfortable', fontScale: 100, defaultPageSize: 50, duplicateKey: 'recommended', visibleColumns: ['gender', 'ageRaw', 'diagnosis', 'clinicalManifestation', 'treatment', 'remark', 'feeRaw'] })
const formSnapshot = ref('')
const filters = reactive({ keyword: '', dateFrom: '', dateTo: '', gender: '' })
const form = reactive<MedicalRecordInput>(emptyForm())

function emptyForm(): MedicalRecordInput {
  return {
    visitDate: new Date().toISOString().slice(0, 10),
    name: '',
    gender: null,
    ageRaw: null,
    diagnosis: null,
    clinicalManifestation: null,
    treatment: null,
    remark: null,
    feeRaw: null
  }
}

const isEditing = computed(() => editingId.value !== null)
const formDirty = computed(() => JSON.stringify(form) !== formSnapshot.value)
const filteredOperations = computed(() => operations.value.filter((item) => {
  if (operationType.value && item.operationType !== operationType.value) return false
  return !operationKeyword.value.trim() || item.summary.includes(operationKeyword.value.trim())
}))

const operationTypeNames: Record<string, string> = { create: '新增', update: '编辑', delete: '删除', import: '导入' }

function applySettings(value: AppSettings): void {
  document.documentElement.style.setProperty('--app-font-size', `${14 * value.fontScale / 100}px`)
  document.documentElement.style.setProperty('--el-font-size-base', `${14 * value.fontScale / 100}px`)
}

async function loadRecords(): Promise<void> {
  loading.value = true
  try {
    let result = await clinicApi.records.list({ page: page.value, pageSize: pageSize.value, ...filters })
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize.value))
    if (page.value > lastPage) {
      page.value = lastPage
      result = await clinicApi.records.list({ page: page.value, pageSize: pageSize.value, ...filters })
    }
    rows.value = result.rows
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载病历失败')
  } finally {
    loading.value = false
  }
}

function resetFilters(): void {
  Object.assign(filters, { keyword: '', dateFrom: '', dateTo: '', gender: '' })
  page.value = 1
  void loadRecords()
}

function openCreate(): void {
  Object.assign(form, emptyForm())
  editingId.value = null
  formSnapshot.value = JSON.stringify(form)
  drawerVisible.value = true
}

function openEdit(record: MedicalRecord): void {
  Object.assign(form, {
    visitDate: record.visitDate,
    name: record.name,
    gender: record.gender,
    ageRaw: record.ageRaw,
    diagnosis: record.diagnosis,
    clinicalManifestation: record.clinicalManifestation,
    treatment: record.treatment,
    remark: record.remark,
    feeRaw: record.feeRaw
  })
  editingId.value = record.id
  formSnapshot.value = JSON.stringify(form)
  drawerVisible.value = true
}

function openView(record: MedicalRecord): void {
  detailRecord.value = record
  detailVisible.value = true
}

function handleRowClick(record: MedicalRecord, column: { type?: string; label?: string }): void {
  if (column.type === 'selection' || column.label === '操作') return
  openView(record)
}

async function persistRecord(): Promise<boolean> {
  if (!form.visitDate || !form.name.trim()) {
    ElMessage.warning('请填写日期和姓名')
    return false
  }
  saving.value = true
  try {
    if (editingId.value === null) {
      await clinicApi.records.create({ ...form })
      ElMessage.success('病历已新增')
    } else {
      await clinicApi.records.update(editingId.value, { ...form })
      ElMessage.success('病历已更新')
    }
    await loadRecords()
    return true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

async function saveRecord(): Promise<void> {
  if (!await persistRecord()) return
  formSnapshot.value = JSON.stringify(form)
  drawerVisible.value = false
}

async function saveAndContinueCreating(): Promise<void> {
  if (isEditing.value || !await persistRecord()) return
  Object.assign(form, emptyForm())
  formSnapshot.value = JSON.stringify(form)
  await nextTick()
  nameInput.value?.focus()
}

function requestEditorClose(done?: () => void): void {
  if (!formDirty.value) { if (done) done(); else drawerVisible.value = false; return }
  pendingEditorClose.value = done
  unsavedConfirmVisible.value = true
}

function finishEditorClose(): void {
  const done = pendingEditorClose.value
  pendingEditorClose.value = undefined
  unsavedConfirmVisible.value = false
  formSnapshot.value = JSON.stringify(form)
  if (done) done(); else drawerVisible.value = false
}

function keepEditing(): void {
  pendingEditorClose.value = undefined
  unsavedConfirmVisible.value = false
}

async function saveAndCloseEditor(): Promise<void> {
  unsavedConfirmVisible.value = false
  if (await persistRecord()) finishEditorClose()
  else pendingEditorClose.value = undefined
}

async function confirmDelete(ids: number[]): Promise<void> {
  if (!ids.length) {
    ElMessage.info('请先选择要删除的病历')
    return
  }
  try {
    await ElMessageBox.confirm('确定删除这条病历吗？系统会在删除前自动备份数据。', '删除确认', {
      confirmButtonText: '确认删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const deleted = await clinicApi.records.deleteBatch([...ids])
    ElMessage.success(`已删除 ${deleted} 条病历`)
    await loadRecords()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '删除失败')
    }
  }
}

async function analyzeImport(): Promise<void> {
  importLoading.value = true
  try {
    importPreview.value = await clinicApi.excel.analyze(duplicateKey.value)
    if (importPreview.value) importVisible.value = true
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'Excel 读取失败')
  } finally {
    importLoading.value = false
  }
}

async function commitImport(): Promise<void> {
  if (!importPreview.value) return
  importLoading.value = true
  try {
    const result = await clinicApi.excel.commit(importPreview.value.token, duplicateAction.value)
    ElMessage.success(`导入完成：新增 ${result.imported} 条，覆盖 ${result.overwritten} 条，跳过 ${result.skipped} 条`)
    importVisible.value = false
    importPreview.value = null
    page.value = 1
    await loadRecords()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入失败，数据未发生改变')
  } finally {
    importLoading.value = false
  }
}

async function exportRecords(): Promise<void> {
  try {
    const result = await clinicApi.excel.exportRecords({ page: 1, pageSize: 200, ...filters })
    if (!result.canceled) ElMessage.success(`已导出 ${result.count} 条病历`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出失败')
  }
}

async function openOperations(): Promise<void> {
  operations.value = await clinicApi.operations.list()
  operationVisible.value = true
}

async function loadOperationDetail(row: OperationLog, expandedRows: OperationLog[]): Promise<void> {
  if (!expandedRows.some((item) => item.id === row.id) || operationDetails[row.id]) return
  const detail = await clinicApi.operations.get(row.id)
  if (detail) operationDetails[row.id] = detail
}

async function createBackup(): Promise<void> {
  const result = await clinicApi.backup.create()
  if (!result.canceled) ElMessage.success('数据库备份完成')
}

async function restoreBackup(): Promise<void> {
  try {
    await ElMessageBox.confirm('恢复备份将替换当前数据，系统会先自动备份现有数据库。是否继续？', '恢复确认', { type: 'warning', confirmButtonText: '选择备份并恢复', cancelButtonText: '取消' })
    if (await clinicApi.backup.restore()) { ElMessage.success('数据已恢复'); page.value = 1; await loadRecords() }
  } catch (error) { if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '恢复失败') }
}

async function exportOperations(): Promise<void> {
  const result = await clinicApi.operations.export()
  if (!result.canceled) ElMessage.success(`已导出 ${result.count} 条操作记录`)
}

async function openSettings(): Promise<void> {
  Object.assign(settings, await clinicApi.settings.get())
  settingsVisible.value = true
}

async function saveSettings(): Promise<void> {
  const saved = await clinicApi.settings.update({ ...settings })
  Object.assign(settings, saved)
  duplicateKey.value = saved.duplicateKey
  pageSize.value = saved.defaultPageSize
  applySettings(saved)
  settingsVisible.value = false
  page.value = 1
  await loadRecords()
  ElMessage.success('设置已保存')
}

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  const input = target?.closest('input') as HTMLInputElement | null
  const inTextInput = Boolean(
    target?.closest('textarea, [contenteditable="true"]') ||
    (input && !['checkbox', 'radio', 'button', 'submit'].includes(input.type))
  )
  if (event.ctrlKey && event.key.toLowerCase() === 'n' && !drawerVisible.value && !inTextInput) {
    event.preventDefault()
    openCreate()
  } else if (event.ctrlKey && event.key.toLowerCase() === 'f' && !drawerVisible.value) {
    event.preventDefault()
    document.querySelector<HTMLInputElement>('[data-testid="record-search-input"]')?.focus()
  } else if ((event.ctrlKey && event.key.toLowerCase() === 's' || event.ctrlKey && event.key === 'Enter') && drawerVisible.value) {
    event.preventDefault(); void saveRecord()
  } else if (event.ctrlKey && event.key.toLowerCase() === 'i' && !inTextInput) {
    event.preventDefault(); void analyzeImport()
  } else if (event.ctrlKey && event.key.toLowerCase() === 'e' && !inTextInput) {
    event.preventDefault(); void exportRecords()
  } else if (event.key === 'F5') {
    event.preventDefault(); void loadRecords()
  } else if (event.key === 'Escape' && drawerVisible.value) {
    void requestEditorClose()
  }
}

async function initialize(): Promise<void> {
  try {
    const saved = await clinicApi.settings.get()
    Object.assign(settings, saved)
    duplicateKey.value = saved.duplicateKey
    pageSize.value = saved.defaultPageSize
    applySettings(saved)
  } catch { /* 使用默认设置 */ }
  await loadRecords()
  dataPath.value = await clinicApi.app.getDataPath()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  void initialize()
})
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-block">
        <div class="brand-mark">诊</div>
        <div>
          <h1>诊所病历</h1>
          <p>本地数据 · 安全可控</p>
        </div>
      </div>
      <div class="topbar-actions">
        <el-button data-testid="record-import-button" plain :icon="Upload" :loading="importLoading" title="导入 Excel (Ctrl+I)" @click="analyzeImport">导入</el-button>
        <el-button data-testid="record-export-button" plain :icon="Download" title="导出 Excel (Ctrl+E)" @click="exportRecords">导出</el-button>
        <el-dropdown trigger="click">
          <el-button plain :icon="MoreFilled">更多</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item data-testid="operation-menu-item" @click="openOperations">操作记录</el-dropdown-item>
              <el-dropdown-item @click="openSettings">显示设置</el-dropdown-item>
              <el-dropdown-item @click="createBackup">备份数据</el-dropdown-item>
              <el-dropdown-item divided @click="restoreBackup">恢复备份</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <main class="content">
      <section class="filter-panel">
        <el-input v-model="filters.keyword" data-testid="record-search-input" clearable placeholder="搜索姓名、诊断、治疗或备注" @keyup.enter="page = 1; loadRecords()" />
        <el-date-picker v-model="filters.dateFrom" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" />
        <el-date-picker v-model="filters.dateTo" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" />
        <el-select v-model="filters.gender" data-testid="gender-filter" clearable placeholder="性别">
          <el-option label="男" value="男" />
          <el-option label="女" value="女" />
          <el-option label="其他/未知" value="其他" />
        </el-select>
        <div class="filter-actions">
          <el-button data-testid="record-query-button" type="primary" @click="page = 1; loadRecords()">查询</el-button>
          <el-button data-testid="record-reset-button" @click="resetFilters">重置</el-button>
        </div>
      </section>

      <section class="table-panel">
        <div class="table-toolbar">
          <div class="total-summary">共 <strong>{{ total.toLocaleString() }}</strong> 张病历</div>
          <div class="toolbar-actions">
            <el-button data-testid="record-create-button" type="primary" :icon="Plus" title="新增病历 (Ctrl+N)" @click="openCreate">新增病历</el-button>
          </div>
        </div>
        <el-table v-loading="loading" data-testid="record-table" :class="{ 'compact-table': settings.tableDensity === 'compact' }" :data="rows" row-key="id" height="100%" border scrollbar-always-on @row-click="handleRowClick">
          <el-table-column prop="visitDate" label="日期" width="106" />
          <el-table-column prop="name" label="姓名" width="100" />
          <el-table-column v-if="settings.visibleColumns.includes('gender')" prop="gender" label="性别" width="64" />
          <el-table-column v-if="settings.visibleColumns.includes('ageRaw')" prop="ageRaw" label="年龄" width="72" />
          <el-table-column v-if="settings.visibleColumns.includes('diagnosis')" prop="diagnosis" label="诊断" min-width="170" show-overflow-tooltip />
          <el-table-column v-if="settings.visibleColumns.includes('clinicalManifestation')" prop="clinicalManifestation" label="临床表现" min-width="170" show-overflow-tooltip />
          <el-table-column v-if="settings.visibleColumns.includes('treatment')" prop="treatment" label="治疗" min-width="200" show-overflow-tooltip />
          <el-table-column v-if="settings.visibleColumns.includes('remark')" prop="remark" label="备注" min-width="150" show-overflow-tooltip />
          <el-table-column v-if="settings.visibleColumns.includes('feeRaw')" prop="feeRaw" label="费用" width="110" />
          <el-table-column label="操作" width="116" fixed="right">
            <template #default="scope">
              <el-button link :icon="View" title="查看" @click.stop="openView(scope.row)" />
              <el-button data-testid="record-edit-button" link type="primary" :icon="EditPen" title="编辑" @click.stop="openEdit(scope.row)" />
              <el-button data-testid="record-row-delete" link type="danger" :icon="Delete" title="删除" @click.stop="confirmDelete([scope.row.id])" />
            </template>
          </el-table-column>
          <template #empty>
            <div class="empty-state"><span class="empty-icon">⌕</span><strong>暂无符合条件的病历</strong><small>调整筛选条件，或新增一条病历记录</small></div>
          </template>
        </el-table>
        <div class="table-footer">
          <span>数据目录：{{ dataPath || '读取中...' }}</span>
          <el-pagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" :page-sizes="[20, 50, 100]" layout="sizes, prev, pager, next" @current-change="loadRecords" @size-change="page = 1; loadRecords()" />
        </div>
      </section>
    </main>

    <el-drawer v-model="drawerVisible" :title="isEditing ? '编辑病历' : '新增病历'" size="min(640px, 94vw)" class="record-editor-drawer" destroy-on-close :close-on-click-modal="false" :before-close="requestEditorClose">
      <el-form label-position="top" @submit.prevent="saveRecord">
        <div class="form-grid editor-form-grid">
          <el-form-item label="日期" required><el-date-picker v-model="form.visitDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
          <el-form-item label="姓名" required><el-input ref="nameInput" v-model="form.name" maxlength="100" show-word-limit /></el-form-item>
          <el-form-item label="性别"><el-select v-model="form.gender" clearable style="width: 100%"><el-option label="男" value="男" /><el-option label="女" value="女" /><el-option label="其他/未知" value="其他" /></el-select></el-form-item>
          <el-form-item label="年龄"><el-input v-model="form.ageRaw" placeholder="保留原始表达，例如 2岁10个月" /></el-form-item>
          <el-form-item label="诊断"><el-input v-model="form.diagnosis" /></el-form-item>
          <el-form-item label="费用"><el-input v-model="form.feeRaw" placeholder="按原始文本保存，例如 295 或 100-80" /></el-form-item>
          <el-form-item label="临床表现"><el-input v-model="form.clinicalManifestation" type="textarea" :rows="3" /></el-form-item>
          <el-form-item label="治疗"><el-input v-model="form.treatment" type="textarea" :rows="3" /></el-form-item>
          <el-form-item class="form-span-full" label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
        </div>
        <div class="drawer-footer">
          <el-button @click="requestEditorClose()">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveRecord">保存</el-button>
          <el-button v-if="!isEditing" data-testid="record-save-continue-button" type="primary" plain :loading="saving" @click="saveAndContinueCreating">保存并继续新建</el-button>
        </div>
      </el-form>
    </el-drawer>

    <el-dialog v-model="unsavedConfirmVisible" title="未保存的内容" width="420px" :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
      <p class="unsaved-message">当前病历有未保存的修改，是否保存后关闭？</p>
      <template #footer>
        <el-button @click="keepEditing">继续编辑</el-button>
        <el-button @click="finishEditorClose">不保存</el-button>
        <el-button type="primary" :loading="saving" @click="saveAndCloseEditor">保存并关闭</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="病历详情" size="min(720px, 92vw)" :close-on-click-modal="false">
      <el-descriptions v-if="detailRecord" :column="1" border>
        <el-descriptions-item label="日期">{{ detailRecord.visitDate }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ detailRecord.name }}</el-descriptions-item>
        <el-descriptions-item label="性别">{{ detailRecord.gender || '-' }}</el-descriptions-item>
        <el-descriptions-item label="年龄">{{ detailRecord.ageRaw || '-' }}</el-descriptions-item>
        <el-descriptions-item label="诊断"><span class="detail-text">{{ detailRecord.diagnosis || '-' }}</span></el-descriptions-item>
        <el-descriptions-item label="临床表现"><span class="detail-text">{{ detailRecord.clinicalManifestation || '-' }}</span></el-descriptions-item>
        <el-descriptions-item label="治疗"><span class="detail-text">{{ detailRecord.treatment || '-' }}</span></el-descriptions-item>
        <el-descriptions-item label="备注"><span class="detail-text">{{ detailRecord.remark || '-' }}</span></el-descriptions-item>
        <el-descriptions-item label="费用">{{ detailRecord.feeRaw || '-' }}</el-descriptions-item>
      </el-descriptions>
      <div class="drawer-footer"><el-button @click="detailVisible = false">关闭</el-button><el-button type="primary" @click="detailVisible = false; openEdit(detailRecord!)">编辑</el-button></div>
    </el-drawer>

    <el-dialog v-model="importVisible" title="导入病历" width="min(920px, 92vw)" data-testid="import-preview" :close-on-click-modal="false">
      <template v-if="importPreview">
        <div class="import-heading">
          <div><strong>{{ importPreview.fileName }}</strong><span>共 {{ importPreview.total }} 行</span></div>
          <el-segmented v-model="duplicateAction" data-testid="import-duplicate-policy" :options="[
            { label: '跳过重复', value: 'skip' }, { label: '保留重复', value: 'keep' }, { label: '覆盖已有', value: 'overwrite' }
          ]" />
        </div>
        <div class="import-stats">
          <div><strong>{{ importPreview.valid }}</strong><span>有效</span></div>
          <div class="warning"><strong>{{ importPreview.warnings }}</strong><span>警告</span></div>
          <div class="danger"><strong>{{ importPreview.errors }}</strong><span>错误</span></div>
          <div class="duplicate"><strong>{{ importPreview.duplicates }}</strong><span>重复</span></div>
        </div>
        <el-table :data="importPreview.rows.slice(0, 500)" height="420" data-testid="import-row-status">
          <el-table-column prop="rowNumber" label="Excel 行" width="85" />
          <el-table-column prop="data.visitDate" label="日期" width="115" />
          <el-table-column prop="data.name" label="姓名" width="110" />
          <el-table-column label="状态" width="90">
            <template #default="scope"><el-tag :type="scope.row.status === 'error' ? 'danger' : scope.row.status === 'warning' ? 'warning' : scope.row.status === 'duplicate' ? 'info' : 'success'">{{ { valid: '有效', warning: '警告', error: '错误', duplicate: '重复' }[scope.row.status as string] }}</el-tag></template>
          </el-table-column>
          <el-table-column label="提示" min-width="270"><template #default="scope">{{ scope.row.messages.join('；') || '校验通过' }}</template></el-table-column>
        </el-table>
        <p v-if="importPreview.rows.length > 500" class="preview-note">当前仅展示前 500 行，提交时会处理全部 {{ importPreview.total }} 行。</p>
      </template>
      <template #footer><el-button @click="importVisible = false">取消</el-button><el-button data-testid="import-submit" type="primary" :loading="importLoading" :disabled="!importPreview || importPreview.errors === importPreview.total" @click="commitImport">确认导入</el-button></template>
    </el-dialog>

    <el-drawer v-model="operationVisible" title="操作记录" size="600px">
      <div class="operation-filters">
        <el-input v-model="operationKeyword" clearable placeholder="搜索操作摘要" />
        <el-select v-model="operationType" clearable placeholder="操作类型"><el-option value="create" label="新增" /><el-option value="update" label="编辑" /><el-option value="delete" label="删除" /><el-option value="import" label="导入" /></el-select>
      </div>
      <div class="operation-toolbar"><el-button @click="exportOperations">导出记录</el-button></div>
      <el-table :data="filteredOperations" data-testid="operation-log-table" height="calc(100vh - 205px)" @expand-change="loadOperationDetail">
        <el-table-column type="expand" width="42">
          <template #default="scope">
            <div class="operation-detail">
              <div v-if="operationDetails[scope.row.id]?.beforeData?.length">
                <strong>操作前</strong>
                <p v-for="record in operationDetails[scope.row.id].beforeData!.slice(0, 20)" :key="`before-${record.id}`">{{ record.visitDate }} · {{ record.name }} · {{ record.diagnosis || '无诊断' }}</p>
                <small v-if="operationDetails[scope.row.id].beforeData!.length > 20">另有 {{ operationDetails[scope.row.id].beforeData!.length - 20 }} 条未展开</small>
              </div>
              <div v-if="operationDetails[scope.row.id]?.afterData?.length">
                <strong>操作后</strong>
                <p v-for="record in operationDetails[scope.row.id].afterData!.slice(0, 20)" :key="`after-${record.id}`">{{ record.visitDate }} · {{ record.name }} · {{ record.diagnosis || '无诊断' }}</p>
                <small v-if="operationDetails[scope.row.id].afterData!.length > 20">另有 {{ operationDetails[scope.row.id].afterData!.length - 20 }} 条未展开</small>
              </div>
              <span v-if="!operationDetails[scope.row.id]" class="detail-loading">正在读取操作详情...</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="时间" width="185"><template #default="scope">{{ new Date(scope.row.createdAt).toLocaleString() }}</template></el-table-column>
        <el-table-column label="操作" min-width="190"><template #default="scope"><strong class="operation-kind">{{ operationTypeNames[scope.row.operationType] }}</strong> {{ scope.row.summary }}</template></el-table-column>
        <el-table-column prop="affectedCount" label="数量" width="70" />
        <el-table-column label="状态" width="80"><template #default="scope"><el-tag :type="scope.row.undoneAt ? 'info' : 'success'">{{ scope.row.undoneAt ? '已回退' : '有效' }}</el-tag></template></el-table-column>
      </el-table>
    </el-drawer>

    <el-dialog v-model="settingsVisible" title="显示设置" width="460px">
      <el-form label-position="top">
        <el-form-item label="表格密度">
          <el-segmented v-model="settings.tableDensity" :options="[{ label: '舒适', value: 'comfortable' }, { label: '紧凑', value: 'compact' }]" />
        </el-form-item>
        <el-form-item label="字体大小">
          <el-segmented v-model="settings.fontScale" :options="[{ label: '90%', value: 90 }, { label: '100%', value: 100 }, { label: '110%', value: 110 }, { label: '120%', value: 120 }]" />
        </el-form-item>
        <el-form-item label="默认每页记录数">
          <el-select v-model="settings.defaultPageSize" data-testid="page-size-setting" style="width: 100%"><el-option :value="20" label="20 条" /><el-option :value="50" label="50 条" /><el-option :value="100" label="100 条" /></el-select>
        </el-form-item>
        <el-form-item label="默认重复判断">
          <el-select v-model="settings.duplicateKey" style="width: 100%">
            <el-option value="recommended" label="日期 + 姓名 + 性别 + 年龄 + 诊断" />
            <el-option value="date_name" label="日期 + 姓名" />
            <el-option value="demographic" label="日期 + 姓名 + 性别 + 年龄" />
            <el-option value="all" label="全部九个字段" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示列">
          <el-checkbox-group v-model="settings.visibleColumns" class="column-options">
            <el-checkbox value="gender" label="性别" />
            <el-checkbox value="ageRaw" label="年龄" />
            <el-checkbox value="diagnosis" label="诊断" />
            <el-checkbox value="clinicalManifestation" label="临床表现" />
            <el-checkbox value="treatment" label="治疗" />
            <el-checkbox value="remark" label="备注" />
            <el-checkbox value="feeRaw" label="费用" />
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="settingsVisible = false">取消</el-button><el-button type="primary" @click="saveSettings">保存设置</el-button></template>
    </el-dialog>
  </div>
</template>
