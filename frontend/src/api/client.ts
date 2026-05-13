import axios, { AxiosResponse } from 'axios'
import { useAuthStore } from '../store/authStore'

const SHM_BASE = import.meta.env.VITE_SHM_BASE_URL || 'https://admin.djvpn.ru/shm/v1'

// SHM API клиент — фронт ходит в SHM напрямую через cookie session_id.
// withCredentials обязателен: cookie ставится самим SHM при логине
// (Caddy уже сконфигурирован: SameSite=None; Secure; Domain=.djvpn.ru).
export const shm = axios.create({
  baseURL: SHM_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

// Backend клиент — нужен только для не-SHM функционала:
// cart, notifications (PostgreSQL), devices/remna-info (Remnawave),
// vpn-конфиги (Marzban), status (Uptime Kuma), maintenance/config.
// JWT-токен больше не передаём — backend сам читает SHM cookie из запроса.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

const handle401 = (err: any) => {
  if (err.response?.status === 401) {
    useAuthStore.getState().logout()
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  }
  return Promise.reject(err)
}

shm.interceptors.response.use(r => r, handle401)
api.interceptors.response.use(r => r, handle401)

// SHM-ответы обёрнуты как { data: [...], items, limit, offset, status }.
// Разворачиваем в массив или единичный элемент.
export function unwrap<T = unknown>(resp: AxiosResponse): T[] {
  const body = resp.data
  if (Array.isArray(body?.data)) return body.data as T[]
  if (Array.isArray(body)) return body as T[]
  return []
}

export function unwrapOne<T = unknown>(resp: AxiosResponse): T | null {
  const arr = unwrap<T>(resp)
  return arr[0] ?? null
}

export default api
