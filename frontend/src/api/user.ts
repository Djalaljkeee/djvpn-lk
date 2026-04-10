import api from './client'
import type { User, UserService, Payment } from '../types'

export const fetchProfile = () =>
  api.get<User>('/user/profile').then(r => r.data)

export const fetchUserServices = () =>
  api.get<UserService[]>('/user/services').then(r => r.data)

export const fetchPayments = () =>
  api.get<Payment[]>('/user/payments').then(r => r.data)

export const fetchReferrals = () =>
  api.get('/user/referrals').then(r => r.data)

export const changeService = (user_service_id: number, service_id: number) =>
  api.post('/user/service/change', { user_service_id, service_id }).then(r => r.data)

export const stopService = (user_service_id: number) =>
  api.post('/user/service/stop', { user_service_id }).then(r => r.data)

export const deleteService = (user_service_id: number) =>
  api.delete('/user/service', { data: { user_service_id } }).then(r => r.data)

export const applyPromoCode = (code: string) =>
  api.post('/user/promo', { code }).then(r => r.data)
