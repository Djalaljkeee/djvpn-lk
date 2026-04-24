import api from './client'

export interface MaintenanceStatus {
  enabled: boolean
  message: string
}

export const fetchMaintenanceStatus = (): Promise<MaintenanceStatus> =>
  api.get<MaintenanceStatus>('/system/maintenance').then((r) => r.data)
