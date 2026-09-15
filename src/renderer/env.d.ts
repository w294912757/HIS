import type { ClinicApi } from '../shared/types'

declare global {
  interface Window {
    clinicApi?: ClinicApi
  }
}

export {}
