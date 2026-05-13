import type {
  User, UserService, ServiceDevices, RemnaUserInfo,
  Payment, ForecastEntry, StatusData,
} from '../types'
import type { PaySystemV2 } from './services'
import type { NotificationItem } from './notifications'
import {
  fetchProfile, fetchUserServices, fetchPayments, fetchForecast,
  fetchServiceOrders, fetchUserDevices, fetchRemnaInfo, fetchStatus,
} from './user'
import { fetchPaySystemsV2 } from './services'
import { fetchNotifications } from './notifications'
import { fetchMaintenanceStatus } from './system'

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

// Старый /api/dashboard агрегировал всё на бэкенде. После перевода фронта на
// прямой SHM API мы делаем то же самое в браузере: параллельные allSettled,
// частичные ошибки не валят страницу.
export const fetchDashboard = async (): Promise<DashboardData> => {
  const [
    profileR, servicesR, paymentsR, forecastR, ordersR, paysystemsR,
    devicesR, remnaR, statusR, notificationsR, maintenanceR,
  ] = await Promise.allSettled([
    fetchProfile(),
    fetchUserServices(),
    fetchPayments(),
    fetchForecast(),
    fetchServiceOrders(),
    fetchPaySystemsV2(),
    fetchUserDevices(),
    fetchRemnaInfo(),
    fetchStatus(),
    fetchNotifications(20),
    fetchMaintenanceStatus(),
  ])

  const errors: Record<string, string> = {}
  const pick = <T>(r: PromiseSettledResult<T>, key: string): T | null => {
    if (r.status === 'fulfilled') return r.value
    errors[key] = r.reason instanceof Error ? r.reason.message : String(r.reason)
    return null
  }

  const profile = pick(profileR, 'profile')
  const services = pick(servicesR, 'services')
  const payments = pick(paymentsR, 'payments')
  const forecastList = pick(forecastR, 'forecast')
  const orders = pick(ordersR, 'orders')
  const paysystems = pick(paysystemsR, 'paysystems')
  const devices = pick(devicesR, 'devices')
  const remna_info = pick(remnaR, 'remna_info')
  const status = pick(statusR, 'status')
  const notifications = pick(notificationsR, 'notifications')
  const maintenance = pick(maintenanceR, 'maintenance')

  return {
    profile,
    balance: profile ? { amount: profile.balance ?? 0, currency: 'RUB' } : null,
    services,
    devices,
    remna_info,
    orders,
    payments,
    paysystems,
    forecast: forecastList ? { data: forecastList } : null,
    notifications: notifications
      ? { items: notifications.items, unread: notifications.unread }
      : null,
    status,
    maintenance: maintenance ?? { enabled: false, message: '' },
    errors,
  }
}
