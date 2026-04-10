import api from './client'
import type { User } from '../types'

export const loginWithPassword = async (login: string, password: string) => {
  const { data } = await api.post<{ token: string; user: User }>('/auth/login', { login, password })
  return data
}

export const loginWithTelegram = async (tgData: object) => {
  const { data } = await api.post<{ token: string; user: User }>('/auth/telegram', tgData)
  return data
}

export const registerWithPassword = async (login: string, password: string, name?: string) => {
  const { data } = await api.post<{ token: string; user: User }>('/auth/register', { login, password, name })
  return data
}
