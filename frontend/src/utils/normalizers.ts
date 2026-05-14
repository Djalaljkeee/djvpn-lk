// SHM возвращает «сырые» поля (user_service_id, expire, status: "ACTIVE",
// money/date в платежах, allow_to_order в каталоге). До перевода фронта на
// прямой SHM API эту трансформацию делал backend (см. backend/normalizers.py).
// Когда роутинг переехал в браузер, нормализацию забыли — из-за этого
// dashboard фильтровал `services.filter(s => s.status === 1)` по строке
// и подписка пропадала, а email_verified=1 (число) не проходил `=== true`.
//
// Здесь дублируем минимально необходимую нормализацию на TS, чтобы фронт
// получал ровно ту же форму, что и до миграции, и компонентам не пришлось
// уметь читать оба формата.

import type {
  Payment, Service, User, UserService,
} from '../types'

const SERVICE_STATUS_MAP: Record<string, number> = {
  ACTIVE: 1,
  BLOCK: 2,
  'NOT PAID': 2,
  STUCK: 2,
  REMOVED: 3,
  INIT: 0,
  PROGRESS: 0,
}

const PAY_SYSTEM_NAMES: Record<string, string> = {
  'yookassa': 'ЮKassa',
  'yookassa-canceled': 'Отменён (ЮKassa)',
  'yookassa-refund': 'Возврат (ЮKassa)',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// SHM кладёт Marzban subscriptionUrl и uuid в svc.data как dict или JSON-строку.
function parseDataField(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try { return asRecord(JSON.parse(raw)) } catch { return {} }
  }
  return asRecord(raw)
}

export function normalizeUserService(svc: Record<string, unknown>): UserService {
  const info = asRecord(svc.service)
  const data = parseDataField(svc.data)
  const infoData = asRecord(info.data)

  const subUrl =
    (svc.subscription_url as string | undefined) ||
    (svc.subscriptionUrl as string | undefined) ||
    (data.subscription_url as string | undefined) ||
    (data.subscriptionUrl as string | undefined) ||
    (infoData.subscriptionUrl as string | undefined)

  const statusKey = String(svc.status ?? '')
  const status = SERVICE_STATUS_MAP[statusKey] ?? 0

  return {
    id: Number(svc.user_service_id ?? svc.id ?? 0),
    service_id: Number(svc.service_id ?? 0),
    name: (info.name as string) || (svc.name as string) || '',
    status,
    created: (svc.created as string) || '',
    expired: (svc.expire as string) || (svc.expired as string) || undefined,
    cost: (info.cost as number | undefined) ?? (svc.cost as number | undefined),
    period: (svc.period as number | undefined) ?? (svc.period_cost as number | undefined),
    period_type: (svc.period_type as string) || 'month',
    descr: (info.descr as string | undefined) || (svc.descr as string | undefined),
    subscription_url: subUrl,
    remna_uuid: data.uuid as string | undefined,
  }
}

export function normalizeCatalogService(svc: Record<string, unknown>): Service {
  const allow = svc.allow_to_order ?? 1
  return {
    service_id: Number(svc.id ?? svc.service_id ?? 0),
    name: (svc.name as string) || '',
    cost: Number(svc.cost ?? 0),
    period: Number(svc.period_cost ?? svc.period ?? 1),
    period_type: (svc.period_type as string) || 'month',
    descr: svc.descr as string | undefined,
    category: svc.category as string | undefined,
    status: allow ? 1 : 0,
    order_only_once: Boolean(svc.order_only_once ?? false),
  }
}

export function normalizePayment(pay: Record<string, unknown>): Payment {
  const psId = String(pay.pay_system_id ?? '')
  const isFailure = psId.includes('canceled') || psId.includes('refund')
  return {
    id: Number(pay.id ?? 0),
    amount: Number(pay.money ?? pay.amount ?? 0),
    pay_system_id: psId ? Number(psId) || undefined : undefined,
    pay_system_name: PAY_SYSTEM_NAMES[psId] ?? psId,
    created: (pay.date as string) || (pay.created as string) || '',
    status: isFailure ? 0 : 1,
    comment: pay.comment as string | undefined,
  }
}

// SHM /user/email отдаёт email_verified как 0/1 или "true"/"false".
// Фронт ожидает boolean. То же делаем со status — на случай, если SHM
// когда-нибудь вернёт числовой статус юзера строкой.
function toBoolish(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  if (typeof value === 'string') {
    const s = value.toLowerCase()
    return s === '1' || s === 'true' || s === 'yes'
  }
  return false
}

export function normalizeUser(user: Record<string, unknown>): User {
  return {
    user_id: Number(user.user_id ?? user.id ?? 0),
    login: (user.login as string) || '',
    login2: user.login2 as string | undefined,
    name: user.name as string | undefined,
    full_name: user.full_name as string | undefined,
    balance: Number(user.balance ?? 0),
    credit: Number(user.credit ?? 0),
    status: Number(user.status ?? 0),
    created: user.created as string | undefined,
    email: user.email as string | undefined,
    email_verified: 'email_verified' in user ? toBoolish(user.email_verified) : undefined,
  }
}
