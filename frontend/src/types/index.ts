export interface User {
  user_id: number
  login: string
  // login2 в SHM — дополнительный логин; используется как поле email после
  // подтверждения почты (см. swagger User.login2).
  login2?: string
  name?: string
  full_name?: string
  balance: number
  // SHM поле `credit` — кредитный лимит (овердрафт), не путать с дисконтом.
  credit: number
  // Скидка пользователя в процентах. SHM возвращает в поле `discount`.
  discount: number
  // Бонусный (баллы/промо) баланс в рублях, поле SHM `bonus`.
  bonus: number
  status: number
  created?: string
  email?: string
  email_verified?: boolean
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
  order_only_once?: boolean
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
  name?: string
  created?: string
  paid: number
  income: number
}

export interface ReferralStats {
  user_id?: number
  commission: number
  total_referrals: number
  total_paid: number
  total_income: number
  referrals: Referral[]
}

export interface PromoApplyResult {
  ok: boolean
  status: number
  message: string
  code: string
}

export interface ServiceActionResult {
  success: boolean
  needs_topup: boolean
  amount_needed: number
  balance: number
  message: string
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
  hwid_device_limit: number | null
  online_at: string | null
  locations: string[]
}
