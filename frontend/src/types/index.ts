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
  status: number        // 1=active, 2=blocked, 3=deleted
  created: string
  expired?: string
  cost?: number
  period?: number
  period_type?: string
  descr?: string
}

export interface Service {
  service_id: number
  name: string
  cost: number
  period: number
  period_type: string   // 'month' | 'day' | 'year'
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
  user_id: number
  login: string
  name?: string
  created: string
  income: number        // начислено от этого реферала
}

export interface ReferralStats {
  total_referrals: number
  total_income: number
  referrals: Referral[]
}
