import api from './client'
import type { User, UserService, Payment, PromoApplyResult, ReferralStats, ServiceDevices, StatusData, ForecastEntry, RemnaUserInfo, ServiceActionResult } from '../types'

export const fetchProfile = () =>
  api.get<User>('/user/profile').then(r => r.data)

export const fetchUserServices = () =>
  api.get<UserService[]>('/user/services').then(r => r.data)

export const fetchPayments = () =>
  api.get<Payment[]>('/user/payments').then(r => r.data)

export const fetchReferrals = () =>
  api.get<ReferralStats>('/user/referrals').then(r => r.data)

export const changeService = (user_service_id: number, service_id: number) =>
  api.post<ServiceActionResult>('/user/service/change', { user_service_id, service_id }).then(r => r.data)

export const stopService = (user_service_id: number) =>
  api.post('/user/service/stop', { user_service_id }).then(r => r.data)

export const deleteService = (user_service_id: number) =>
  api.delete('/user/service', { data: { user_service_id } }).then(r => r.data)

export const applyPromoCode = (code: string) =>
  api.post<PromoApplyResult>('/user/promo', { code }).then(r => r.data)

export const fetchServiceOrders = (): Promise<{ service_id: number }[]> =>
  api.get('/user/service/orders').then(r => r.data)

export const fetchUserDevices = () =>
  api.get<ServiceDevices[]>('/user/devices').then(r => r.data)

export const deleteDevice = (hwid: string, user_service_id: number) =>
  api.delete('/user/devices', { data: { hwid, user_service_id } }).then(r => r.data)

export const fetchStatus = () =>
  api.get<StatusData>('/status').then(r => r.data)

export const fetchForecast = () =>
  api.get<{ data: ForecastEntry[] }>('/user/pay/forecast').then(r => r.data.data ?? [])

export const fetchRemnaInfo = () =>
  api.get<RemnaUserInfo[]>('/user/remna-info').then(r => r.data)

export const deleteAllDevices = (user_service_id: number) =>
  api.delete<{ deleted: number; failed: number }>('/user/devices/all', { data: { user_service_id } }).then(r => r.data)

export const updateEmail = (email: string) =>
  api
    .put<{ ok: boolean; email: string; verification_sent?: boolean }>('/user/email', { email })
    .then(r => r.data)

export const requestEmailVerification = () =>
  api.post<{ ok: boolean; email: string; message: string }>('/user/email/request-verify').then(r => r.data)

export const verifyEmailToken = (token: string) =>
  api
    .post<{ ok: boolean; verified: boolean; message: string }>('/user/email/verify', { token })
    .then(r => r.data)

export const changePassword = (password: string) =>
  api.post<{ ok: boolean }>('/user/passwd', { password }).then(r => r.data)
