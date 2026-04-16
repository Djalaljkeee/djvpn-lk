export interface User {
  user_id: number
  login: string
  name?: string
  balance: number
  credit: number
  status: number
  created?: string
}

export interface UserService {
  id: number
  service_id: number
  name: string
  status: number
  created: string
  expired?: string
  cost?: number
  period?: number
  period_type?: string
  descr?: string
  subscription_url?: string
  remna_uuid?: string
}

export interface Service {
  service_id: number
  name: string
  cost: number
  period: number
  period_type: string
  descr?: string
  category?: string
  status: number
}

export interface PaySystem {
  pay_system_id: number
  name: string
  currency?: string
  min_amount?: number
  commission?: number
}

export interface Payment {
  id: number
  amount: number
  pay_system_id?: number
  pay_system_name?: string
  created: string
  status: number
  comment?: string
}

export interface Referral {
  user_id?: number
  login?: string
  name?: string
  created?: string
  income?: number
  total?: number
}

export interface ReferralStats {
  total_referrals: number
  total_income: number
  items: number
  referrals?: Referral[]
}

export interface PromoApplyResult {
  ok: boolean
  status: number
  message: string
  code: string
}

export interface Device {
  hwid: string
  platform?: string
  deviceModel?: string
  last_seen?: string
  userAgent?: string
}

export interface ServiceDevices {
  service_id: number
  service_name: string
  user_service_id: number
  devices: Device[]
}

export interface StatusMonitor {
  id: number
  name: string
  status: number       // 1 = up, 0 = down, 2 = pending
  ping: number         // ms
  uptime_24: number | null
  uptime_720: number | null
}

export interface StatusGroup {
  id: number
  name: string
  monitors: StatusMonitor[]
}

export interface StatusData {
  groups: StatusGroup[]
  status_url: string
}

export interface ForecastNextItem {
  bonus: number
  cost: number
  discount: number
  months: number
  name: string
  qnt: number
  service_id?: number
  total: number
}

export interface ForecastServiceItem {
  cost: number
  discount: number
  expire?: string
  months: number
  name: string
  next?: ForecastNextItem
  qnt: number
  service_id?: string
  status?: string
  total: number
  user_service_id?: string
  usi?: string
}

export interface ForecastEntry {
  balance: number
  bonuses: number
  dept: number
  items: ForecastServiceItem[]
  total: number
}

export interface RemnaUserInfo {
  user_service_id: number
  used_traffic_bytes: number | null
  traffic_limit_bytes: number | null
  limit_ip: number | null
  locations: string[]
}
