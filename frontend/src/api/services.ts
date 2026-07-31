import api, { shm, unwrap } from './client'
import type { Service } from '../types'
import { useAuthStore } from '../store/authStore'
import { normalizeCatalogService } from '../utils/normalizers'

// ---------------------------------------------------------------------------
// SHM (фронт ходит напрямую)
// ---------------------------------------------------------------------------

export const fetchServices = async (): Promise<Service[]> => {
  const resp = await shm.get('/service/order')
  return unwrap<Record<string, unknown>>(resp).map(normalizeCatalogService)
}

export interface BuyServiceResult {
  // SHM возвращает обёртку с созданной USObject. Поля needs_topup/amount_needed/
  // balance — наследие от backend-логики (с admin-расчётом цены). Сейчас SHM
  // либо успешно создаёт заказ, либо отвечает ошибкой при нехватке баланса,
  // которую фронт ловит в catch.
  needs_topup?: boolean
  amount_needed?: number
  balance?: number
  data?: unknown
}

export const buyService = async (service_id: number): Promise<BuyServiceResult> => {
  const resp = await shm.put('/service/order', { service_id })
  return (resp.data || {}) as BuyServiceResult
}

export interface PaySystemV2 {
  name: string
  // Готовый URL платёжной формы. SHM может вернуть его уже c подставленным
  // user_id/ts/email, либо вообще не вернуть — тогда фронт строит URL сам
  // через buildPaymentUrl.
  shm_url?: string
  paysystem?: string
  recurring?: number
  // SHM выставляет allow_deletion=1 у сохранённых способов оплаты (привязанная
  // карта автоплатежа, приходит в списке как «Bank card *5777»). Такой способ
  // можно отвязать через DELETE /user/autopayment.
  allow_deletion?: number
  min_sum?: number
  max_sum?: number
}

export const fetchPaySystemsV2 = async (): Promise<PaySystemV2[]> => {
  const resp = await shm.get('/user/pay/paysystems')
  return unwrap<PaySystemV2>(resp)
}

// Отвязка сохранённого способа оплаты (рекуррентная карта). SHM ждёт код
// платёжной системы в query-параметре: DELETE /user/autopayment?pay_system=<id>
// — ровно так же это делает штатный Telegram WebApp-шаблон SHM.
export const deleteAutopayment = async (pay_system: string): Promise<void> => {
  await shm.delete('/user/autopayment', { params: { pay_system } })
}

// Платёж создаётся через redirect на bill.djvpn.ru — SHM не предоставляет
// REST-эндпоинта для создания платежа. Параметры: текущий user_id, email
// из login2 (см. swagger User.login2), сумма и код платёжной системы.
export const BILL_BASE_URL = import.meta.env.VITE_SHM_BILL_URL || 'https://bill.djvpn.ru'

export interface BuildPaymentUrlArgs {
  ps: string
  amount: number
  user_id?: number
  email?: string
}

export const buildPaymentUrl = ({ ps, amount, user_id, email }: BuildPaymentUrlArgs): string => {
  const user = useAuthStore.getState().user
  const uid = user_id ?? user?.user_id
  const mail = email ?? (user as { login2?: string } | null)?.login2 ?? user?.email ?? ''
  const ts = Math.floor(Date.now() / 1000)
  const params = new URLSearchParams({
    action: 'create',
    user_id: String(uid ?? ''),
    ts: String(ts),
    ps,
    amount: String(amount),
    email: mail,
  })
  return `${BILL_BASE_URL}/shm/pay_systems/${encodeURIComponent(ps)}.cgi?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Backend (config — не SHM)
// ---------------------------------------------------------------------------

export const fetchConfig = (): Promise<{ telegram_bot_username: string }> =>
  api.get('/config').then(r => r.data)
