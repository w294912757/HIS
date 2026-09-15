import type { ClinicApi } from '../../shared/types'
import { createBrowserClinicApi } from './browser'

export const clinicApi: ClinicApi = window.clinicApi || createBrowserClinicApi()
export const isDesktop = Boolean(window.clinicApi)
