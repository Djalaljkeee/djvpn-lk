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

// Комиссия по умолчанию, если SHM-шаблон не прислал поле commission.
// Исторический процент реферальной программы — 15%. Расхождение с реальным
// коэффициентом (SHM может считать иначе, см. ниже) логируем в console.warn.
const DEFAULT_COMMISSION = 15

export const fetchReferrals = async (): Promise<ReferralStats> => {
  // SHM-шаблон template/refferalslist?format=json считает оплаты каждого
  // реферала и доход с них. Авторизация по session_id (cookie приходит сама
  // через shm-клиент). user_id шаблон берёт из сессии — query-параметр не
  // нужен, и нельзя подделать чужой id. Опечатка `refferalslist` (двойное f)
  // — на стороне SHM, не переименовываем.
  const resp = await shm.get('/template/refferalslist', {
    params: { format: 'json' },
  })
  return normalizeReferralStats(resp.data)
}

export function normalizeReferralStats(body: unknown): ReferralStats {
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // commission — источник истины из ответа SHM (исторически 15%, сейчас 20%
  // по настройкам SHM). Если поле отсутствует/невалидно — fallback на 15%
  // + warn, чтобы рассинхрон с реальной комиссией не прошёл молча.
  let commission = Number(obj.commission)
  if (!Number.isFinite(commission) || commission < 0) {
    console.warn('[referrals] SHM не прислал валидный commission, fallback на', DEFAULT_COMMISSION)
    commission = DEFAULT_COMMISSION
  }

  // SHM именует список `referrals` (текущий шаблон), но на всякий случай
  // принимаем и `items` (если шаблон когда-нибудь переименуют).
  const rawItems = Array.isArray(obj.referrals)
    ? obj.referrals
    : (Array.isArray(obj.items) ? obj.items : [])

  const referrals: Referral[] = rawItems
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map(it => {
      // full_name — основное поле в SHM. Если пусто (бывает у юзеров
      // зарегистрированных через email) — fallback на login (@username или
      // email). Поле name тоже поддерживаем — на случай переименования шаблона.
      const fullName = typeof it.full_name === 'string' ? it.full_name.trim() : ''
      const altName = typeof it.name === 'string' ? it.name.trim() : ''
      const login = typeof it.login === 'string' ? it.login.trim() : ''
      const name = fullName || altName || login || undefined
      return {
        user_id: it.user_id != null ? Number(it.user_id) || undefined : undefined,
        name,
        login: login || undefined,
        created: typeof it.created === 'string' ? it.created : undefined,
        paid: Number(it.paid) || 0,
        income: Number(it.income) || 0,
      }
    })

  // SHM считает количество как `count`, на случай legacy-шаблона —
  // принимаем и `total_referrals`. Fallback на длину списка, если ни то ни
  // другое не прислали.
  const countRaw = Number(obj.count)
  const totalRaw = Number(obj.total_referrals)
  const total_referrals = Number.isFinite(countRaw) && countRaw > 0
    ? countRaw
    : Number.isFinite(totalRaw) && totalRaw > 0
      ? totalRaw
      : referrals.length

  // Дельты «за последние 30 дней»:
  //  • количество рефералов считаем на фронте из created — это надёжно;
  //  • доход/оборот ждём от SHM (paid_30d/income_30d). Из списка рефералов
  //    их корректно не вытянуть: реферал мог зарегистрироваться давно, а
  //    платежи — недавно. Пока SHM не пришлёт — оставляем null, UI не
  //    отрисует строку с дельтой.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const isWithin30d = (created?: string): boolean => {
    if (!created) return false
    const ts = Date.parse(created.replace(' ', 'T'))
    return Number.isFinite(ts) && ts >= cutoff
  }
  const referrals_30d = referrals.filter(r => isWithin30d(r.created)).length

  // Активный реферал — тот, у кого есть хотя бы один платёж (paid > 0).
  // Считаем по списку рефералов (SHM отдаёт paid в каждой записи). Если
  // SHM когда-нибудь начнёт присылать готовое поле — уважаем его.
  const isActive = (r: Referral) => r.paid > 0
  const activeFromList = referrals.filter(isActive).length
  const activeRaw = Number(obj.active_count ?? obj.active_referrals)
  const active_referrals = Number.isFinite(activeRaw) && activeRaw >= 0
    ? activeRaw
    : activeFromList
  const active_referrals_30d = referrals
    .filter(r => isActive(r) && isWithin30d(r.created))
    .length

  const parseOptionalNumber = (raw: unknown): number | null => {
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }

  return {
    user_id: obj.user_id != null ? Number(obj.user_id) || undefined : undefined,
    commission,
    total_referrals,
    active_referrals,
    total_paid: Number(obj.total_paid) || 0,
    total_income: Number(obj.total_income) || 0,
    referrals,
    referrals_30d,
    active_referrals_30d,
    paid_30d: parseOptionalNumber(obj.paid_30d),
    income_30d: parseOptionalNumber(obj.income_30d),
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
