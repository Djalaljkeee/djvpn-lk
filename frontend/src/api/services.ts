import api from './client'
import type { Service, PaySystem } from '../types'

export const fetchConfig = (): Promise<{ telegram_bot_username: string }> =>
  api.get('/config').then(r => r.data)

export const fetchServices = () =>
  api.get<Service[]>('/services').then(r => r.data)

export const buyService = (service_id: number) =>
  api.post('/services/buy', { service_id }).then(r => r.data)

export const fetchPaySystems = () =>
  api.get<PaySystem[]>('/pay-systems').then(r => r.data)

export const createPayment = (pay_system_id: number, amount: number) =>
  api.post('/pay/create', { pay_system_id, amount }).then(r => r.data)

export const fetchPaymentWebappUrl = (): Promise<string> =>
  api.get<{ url: string }>('/pay/webapp-url').then(r => r.data.url)

export interface PaySystemV2 {
  name: string
  shm_url: string
  paysystem?: string
  recurring?: number
  min_sum?: number
  max_sum?: number
}

export const fetchPaySystemsV2 = (): Promise<PaySystemV2[]> =>
  api.get<PaySystemV2[]>('/pay/paysystems').then(r => r.data)
