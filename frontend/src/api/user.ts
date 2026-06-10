import api, { shm, unwrap, unwrapOne } from './client'
import type {
  User, UserService, Payment, PromoApplyResult, Referral, ReferralStats,
  ServiceDevices, StatusData, ForecastEntry, RemnaUserInfo, ServiceActionResult,
} from '../types'
import {
  normalizePayment, normalizeUser, normalizeUserService,
} from '../utils/normalizers'

// ---------------------------------------------------------------------------
// SHM (фронт ходит напрямую в admin.djvpn.ru/shm/v1)
// ---------------------------------------------------------------------------

export const fetchProfile = async (): Promise<User> => {
  const userResp = await shm.get('/user')
  const rawUser = unwrapOne<Record<string, unknown>>(userResp)
  if (!rawUser) throw new Error('SHM /user не вернул профиль')
  // SHM /user/email отдаёт {email, email_verified: 0|1} отдельным запросом —
  // мерджим в профиль до нормализации, чтобы email_verified прошёл через
  // приведение к boolean (иначе ProfilePage остаётся в состоянии «Не подтверждён»).
  try {
    const emailResp = await shm.get('/user/email')
    const emailObj = unwrapOne<Record<string, unknown>>(emailResp)
    if (emailObj) Object.assign(rawUser, emailObj)
  } catch {
    // 404 если email ещё не привязан — это нормально.
  }
  return normalizeUser(rawUser)
}

export const fetchUserServices = async (): Promise<UserService[]> => {
  const resp = await shm.get('/user/service')
  return unwrap<Record<string, unknown>>(resp).map(normalizeUserService)
}

export const fetchPayments = async (): Promise<Payment[]> => {
  const resp = await shm.get('/user/pay')
  return unwrap<Record<string, unknown>>(resp).map(normalizePayment)
}

export const fetchReferrals = async (): Promise<ReferralStats> => {
  const resp = await shm.get('/user/referrals', { params: { limit: 25, offset: 0 } })
  const body = resp.data
  // SHM может вернуть либо плоский summary, либо стандартный wrapper
  // {data:[{user_id, login, income, ...}, ..., {total: N}], items, status}.
  // Раньше summary считал бэкенд (см. get_referrals в backend/routers/user.py
  // до commit 0ea83d1). При переходе фронта на прямой SHM нормализатор
  // забыли портировать — unwrapOne брал data[0] (один реферал) и читал с
  // него total_income/total_referrals → undefined, виджет «Заработано»
  // навсегда показывал 0 ₽.
  if (body && typeof body === 'object' && 'total_referrals' in body) {
    return body as ReferralStats
  }
  return aggregateReferrals(unwrap<Record<string, unknown>>(resp))
}

export function aggregateReferrals(rawItems: Record<string, unknown>[]): ReferralStats {
  let total_referrals = 0
  let total_income = 0
  const referrals: Referral[] = []

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue
    // SHM добавляет в data «маркер total»: {total: N} без user_id —
    // это общее число рефералов с учётом limit/offset, а не отдельный реферал.
    if (item.total != null && item.user_id == null) {
      total_referrals = Number(item.total) || 0
      continue
    }
    const income = Number(item.income ?? 0) || 0
    total_income += income
    referrals.push({
      user_id: item.user_id != null ? Number(item.user_id) : undefined,
      login: item.login as string | undefined,
      name: item.name as string | undefined,
      created: item.created as string | undefined,
      income,
    })
  }

  if (!total_referrals) total_referrals = referrals.length

  return {
    total_referrals,
    total_income,
    items: referrals.length,
    referrals,
  }
}

export const changeService = async (
  user_service_id: number,
  service_id: number,
): Promise<ServiceActionResult> => {
  const resp = await shm.post('/user/service/change', { user_service_id, service_id })
  const body = resp.data
  // Backend раньше возвращал ServiceActionResult с балансом/требуемым доплатом.
  // SHM возвращает только статус — мапим в совместимый формат.
  return {
    success: body?.status === 200 || body?.success === true || true,
    needs_topup: false,
    amount_needed: 0,
    balance: 0,
    message: body?.message || 'Тариф изменён',
  }
}

export const stopService = (user_service_id: number) =>
  shm.post('/user/service/stop', { user_service_id }).then(r => r.data)

export const deleteService = (user_service_id: number) =>
  shm.delete('/user/service', { params: { user_service_id } }).then(r => r.data)

export const applyPromoCode = async (code: string): Promise<PromoApplyResult> => {
  // GET /promo/apply/{code}. Успех — 200, иначе SHM кидает ошибку.
  const resp = await shm.get(`/promo/apply/${encodeURIComponent(code)}`)
  const body = resp.data
  const message = typeof body === 'string'
    ? body
    : (body?.message || 'Промокод применён')
  return { ok: true, status: 200, message, code }
}

export const fetchServiceOrders = async (): Promise<{ service_id: number }[]> => {
  const resp = await shm.get('/service/order')
  // SHM хранит идентификатор тарифа в поле `id`, дашборду нужен `service_id`
  // (для матча с TRIAL_SERVICE_ID и owned-фильтром).
  return unwrap<Record<string, unknown>>(resp).map(item => ({
    service_id: Number(item.id ?? item.service_id ?? 0),
  }))
}

export const fetchForecast = async (): Promise<ForecastEntry[]> => {
  const resp = await shm.get('/user/pay/forecast')
  return unwrap<ForecastEntry>(resp)
}

export const updateEmail = async (email: string): Promise<{ ok: boolean; email: string; verification_sent?: boolean }> => {
  await shm.put('/user/email', { email })
  let verification_sent = false
  try {
    await shm.post('/user/email', { email })
    verification_sent = true
  } catch {
    // SHM может ещё не уметь рассылать письма — пропускаем.
  }
  return { ok: true, email, verification_sent }
}

export const requestEmailVerification = async (): Promise<{ ok: boolean; email: string; message: string }> => {
  // Перевыпуск кода: POST /user/email (тело пустое — email возьмётся из профиля).
  const resp = await shm.post('/user/email', {})
  const body = resp.data
  return {
    ok: true,
    email: body?.email || '',
    message: typeof body === 'string' ? body : (body?.message || 'Код отправлен повторно'),
  }
}

export const verifyEmailToken = async (token: string): Promise<{ ok: boolean; verified: boolean; message: string }> => {
  const resp = await shm.post('/user/email/verify', { token })
  const body = resp.data
  return {
    ok: true,
    verified: true,
    message: typeof body === 'string' ? body : (body?.message || 'Email подтверждён'),
  }
}

export const changePassword = async (password: string): Promise<{ ok: boolean }> => {
  await shm.post('/user/passwd', { password })
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Backend (Remnawave/Uptime Kuma — НЕ-SHM, остаются на FastAPI)
// ---------------------------------------------------------------------------

export const fetchUserDevices = () =>
  api.get<ServiceDevices[]>('/user/devices').then(r => r.data)

export const deleteDevice = (hwid: string, user_service_id: number) =>
  api.delete('/user/devices', { data: { hwid, user_service_id } }).then(r => r.data)

export const deleteAllDevices = (user_service_id: number) =>
  api.delete<{ deleted: number; failed: number }>('/user/devices/all', { data: { user_service_id } }).then(r => r.data)

export const fetchRemnaInfo = () =>
  api.get<RemnaUserInfo[]>('/user/remna-info').then(r => r.data)

export const fetchStatus = () =>
  api.get<StatusData>('/status').then(r => r.data)
