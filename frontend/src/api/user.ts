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

export const fetchReferrals = async (userId: number): Promise<ReferralStats> => {
  // Публичный SHM-шаблон считает оплаты каждого реферала и доход с них.
  // Проходит через тот же /api/shm-прокси без session_id (см. shm_proxy.py),
  // user_id передаём из профиля. Опечатка `refferalslist` (двойное f) — на
  // стороне SHM, не переименовываем. format=html — это проверенный заказчиком
  // запрос; шаблон всё равно отдаёт toJson(...), формат влияет лишь на
  // content-type, а данные приходят одинаково (см. normalizeReferralStats).
  const resp = await shm.get('/public/refferalslist', {
    params: { format: 'html', user_id: userId },
  })
  return normalizeReferralStats(resp.data)
}

export function normalizeReferralStats(body: unknown): ReferralStats {
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Текущий SHM-шаблон отдаёт Telegram-сообщение: {chat_id, parse_mode, text}.
  // Полезные данные (рефералы, суммы, комиссия) лежат внутри HTML-строки text.
  // Если когда-нибудь появится «чистый» JSON-шаблон с полем items — ветка
  // structured ниже разберёт его без изменений. text парсим только когда
  // структурированных items нет (иначе чистый JSON приоритетнее).
  if (typeof obj.text === 'string' && !Array.isArray(obj.items)) {
    return parseReferralText(obj.text)
  }

  // commission — источник истины из ответа SHM (шаблон может считать не 15%).
  // Если поле отсутствует/невалидно — fallback на исторические 15% + warn,
  // чтобы заказчик заметил рассинхрон в DevTools.
  let commission = Number(obj.commission)
  if (!Number.isFinite(commission) || commission < 0) {
    console.warn('[referrals] SHM не прислал валидный commission, fallback на', DEFAULT_COMMISSION)
    commission = DEFAULT_COMMISSION
  }

  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const referrals: Referral[] = rawItems
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map(it => ({
      user_id: it.user_id != null ? Number(it.user_id) || undefined : undefined,
      name: typeof it.name === 'string' ? it.name : undefined,
      created: typeof it.created === 'string' ? it.created : undefined,
      paid: Number(it.paid) || 0,
      income: Number(it.income) || 0,
    }))

  return {
    user_id: obj.user_id != null ? Number(obj.user_id) || undefined : undefined,
    commission,
    total_referrals: Number(obj.total_referrals) || referrals.length,
    total_paid: Number(obj.total_paid) || 0,
    total_income: Number(obj.total_income) || 0,
    referrals,
  }
}

// Разбор Telegram-сообщения из SHM-шаблона. Формат строки реферала стабилен:
//   «N. Имя — оплачено: P₽ · ваш доход: I₽» (записи идут подряд без разделителя).
// Имя ограничено устойчивой последовательностью « — оплачено:», поэтому
// безопасно матчим не-жадным шаблоном даже при эмодзи/цифрах/«·» в имени.
// Итоги и комиссию берём из строк-footer'а (они авторитетнее суммы по строкам:
// SHM печатает доход с 3 знаками, поэлементная сумма может разойтись на копейки).
function parseReferralText(text: string): ReferralStats {
  // parse_mode=HTML → срезаем теги (<b> и т.п.), чтобы не мешали regex.
  const plain = text.replace(/<[^>]+>/g, '')

  const referrals: Referral[] = []
  const rowRe = /\d+\.\s+(.+?)\s+—\s+оплачено:\s*([\d.]+)\s*₽\s*·\s*ваш доход:\s*([\d.]+)\s*₽/gu
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(plain)) !== null) {
    referrals.push({
      name: m[1].trim(),
      paid: Number(m[2]) || 0,
      income: Number(m[3]) || 0,
    })
  }

  // «🎁 Ваш доход (20%): 5460.976₽» — комиссия в скобках + итоговый доход.
  const commissionMatch = plain.match(/ваш доход\s*\(\s*([\d.]+)\s*%\s*\)/i)
  const totalPaidMatch = plain.match(/всего оплачено рефералами:\s*([\d.]+)\s*₽/i)
  const totalIncomeMatch = plain.match(/ваш доход\s*\([^)]*\)\s*:\s*([\d.]+)\s*₽/i)

  let commission = commissionMatch ? Number(commissionMatch[1]) : NaN
  if (!Number.isFinite(commission) || commission < 0) commission = DEFAULT_COMMISSION

  const total_paid = totalPaidMatch
    ? Number(totalPaidMatch[1]) || 0
    : referrals.reduce((s, r) => s + r.paid, 0)
  const total_income = totalIncomeMatch
    ? Number(totalIncomeMatch[1]) || 0
    : referrals.reduce((s, r) => s + r.income, 0)

  return {
    commission,
    total_referrals: referrals.length,
    total_paid,
    total_income,
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
