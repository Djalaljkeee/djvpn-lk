import api from './client'
import type { User } from '../types'

export interface AuthResult {
  token: string
  user: User
  email_verification_sent?: boolean
}

export interface RegisterPayload {
  login: string
  password: string
  name?: string
  email?: string
  captcha_token?: string
  captcha_code?: string
  partner_id?: number
}

export const loginWithPassword = async (login: string, password: string) => {
  const { data } = await api.post<AuthResult>('/auth/login', { login, password })
  return data
}

export const loginWithTelegram = async (tgData: object, partnerId?: number) => {
  const body = partnerId ? { ...tgData, partner_id: partnerId } : tgData
  const { data } = await api.post<AuthResult>('/auth/telegram', body)
  return data
}

export const registerWithPassword = async (payload: RegisterPayload) => {
  const { data } = await api.post<AuthResult>('/auth/register', payload)
  return data
}

export const loginWithWebApp = async (initData: string, partnerId?: number) => {
  const params: Record<string, string> = { initData }
  if (partnerId) params.partner_id = String(partnerId)
  const { data } = await api.get<AuthResult>('/auth/webapp', { params })
  return data
}

export interface CaptchaData {
  token: string
  image: string
  content_type: string
  image_url?: string | null
}

export const fetchCaptcha = async (): Promise<CaptchaData> => {
  const { data } = await api.get<CaptchaData>('/captcha')
  return data
}
