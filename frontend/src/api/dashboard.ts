import api from './client'
import type {
  User, UserService, ServiceDevices, RemnaUserInfo,
  Payment, ForecastEntry, StatusData,
} from '../types'
import type { PaySystemV2 } from './services'
import type { NotificationItem } from './notifications'

export interface DashboardBalance {
  amount: number
  currency: string
}

export interface DashboardMaintenance {
  enabled: boolean
  message: string
}

export interface DashboardNotifications {
  items: NotificationItem[]
  unread: number
}

export interface DashboardData {
  profile: User | null
  balance: DashboardBalance | null
  services: UserService[] | null
  devices: ServiceDevices[] | null
  remna_info: RemnaUserInfo[] | null
  // Каталог услуг, доступных к заказу (фронту нужен service_id для проверки trial).
  orders: { service_id: number }[] | null
  payments: Payment[] | null
  paysystems: PaySystemV2[] | null
  forecast: { data: ForecastEntry[] } | null
  notifications: DashboardNotifications | null
  status: StatusData | null
  maintenance: DashboardMaintenance
  errors: Record<string, string>
}

export const fetchDashboard = (): Promise<DashboardData> =>
  api.get<DashboardData>('/dashboard').then(r => r.data)
