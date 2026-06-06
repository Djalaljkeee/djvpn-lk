import axios, { AxiosResponse } from 'axios'
import { useAuthStore } from '../store/authStore'

const SHM_BASE = import.meta.env.VITE_SHM_BASE_URL || '/api/shm/v1'

// Без явного timeout axios ждёт ответа бесконечно. На мобильной сети,
// при переключении Wi-Fi → LTE или из-под TG WebView один зависший TCP
// заваливал весь дашборд: fetchDashboard() делает Promise.allSettled
// по 11 запросам, и если ХОТЯ БЫ один не отвечает, allSettled ждёт его
// навечно. dashboardStore.inflight остаётся залипшим Promise'ом,
// последующие ensure() возвращают его же, ничего нового не дёргается —
// именно так выглядит "frontend silence" в логах: notifications+
// maintenance polls идут, но никаких /v1/user* и /api/user/* нет.
// 15 секунд — с запасом на любой здоровый SHM-ответ (медиана 100ms),
// а зависший request отвалится с ECONNABORTED и Promise.allSettled
// корректно завершит цикл. inflight чистится в .finally.
const TIMEOUT_MS = 15_000

// SHM API клиент — фронт ходит в backend-прокси /api/shm/* same-origin.
// Backend форвардит запрос в admin.djvpn.ru/shm/v1/* и переписывает Set-Cookie
// так, чтобы session_id жила на домене ЛК. Это снимает CORS полностью:
// cookie ставится и шлётся как для собственного сайта.
export const shm = axios.create({
  baseURL: SHM_BASE,
  withCredentials: true,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

// Backend клиент — нужен только для не-SHM функционала:
// cart, notifications (PostgreSQL), devices/remna-info (Remnawave),
// vpn-конфиги (Marzban), status (Uptime Kuma), maintenance/config.
// JWT-токен больше не передаём — backend сам читает SHM cookie из запроса.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

// Гард против шторма редиректов: дашборд бьёт 11 запросов параллельно,
// и если все 11 ловят 401, без флага они все одновременно делают
// window.location.href = '/login'. В обычном Chrome это безвредно, но
// внутри Telegram WebView гонка из нескольких location-assign'ов вешает
// поток и страница перестаёт реагировать на тапы. Один редирект — один раз.
let redirectingOn401 = false
const handle401 = (err: any) => {
  if (err.response?.status === 401) {
    if (!redirectingOn401) {
      redirectingOn401 = true
      useAuthStore.getState().logout()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
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
