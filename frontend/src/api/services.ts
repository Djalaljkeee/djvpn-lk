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
