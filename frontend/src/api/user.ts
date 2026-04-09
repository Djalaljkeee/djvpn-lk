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
