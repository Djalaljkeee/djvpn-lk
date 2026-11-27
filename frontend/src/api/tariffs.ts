import { shm } from './client'

// Клиентские шаблоны SHM для тарифов по устройствам (tariff_info,
// addon_device_order, addon_device_cancel, tariff_upgrade). Шаблоны сами
// проверяют, что услуга принадлежит пользователю сессии, и отвечают JSON
// вида { ok, error?, ... }. Ошибку шаблона превращаем в TariffError с кодом.

export interface AddonItem {
  usi: number
  expire: string
  cancelled: 0 | 1
  cost: number
}

export interface TariffInfo {
  ok: 1
  usi: number
  service_id: number
  status: string
  expire: string
  tier: '' | 'base' | 'family'
  base_devices: number
  addons: number
  addons_cancelled: number
  addon_list: AddonItem[]
  devices: number
  addons_available: 0 | 1
  addon_monthly?: number
  family_service_id: number
  pending_upgrade: number
  hwid_enforce: 0 | 1
  manual_limit: number | ''
  tiers: Record<string, string>
}

export interface AddonQuote {
  action: 'quote' | 'bought'
  price: number
  balance: number
  need_pay: number
  expire: string
  devices: number
  addons: number
  addon_monthly: number
  free?: 0 | 1
  addon_usi?: number
  charged?: number
}

export interface AddonCancelResult {
  action: 'quote' | 'cancelled'
  addons: number
  cancelled: number
  addon_usi: number
  until: string
}

export interface UpgradeQuote {
  action: 'quote' | 'pay_required' | 'upgraded'
  price: number
  discount: number
  refund: number
  balance: number
  need_pay: number
  addons: number
  // Не отменённые доп. устройства, которые переносятся на новый базовый тариф
  // (на полный новый период, их цена — addons_price — входит в price).
  keep_addons: number
  addons_price: number
  tariff_price: number
  new_service: string
  new_period: number
  new_tier: 'base' | 'family'
  devices: number
  expire?: string
}

const ERRORS: Record<string, string> = {
  service_not_found: 'Услуга не найдена',
  service_not_active: 'Тариф не активен — сначала оплатите продление',
  addons_not_available: 'Для этого тарифа доп. устройства недоступны',
  addon_service_missing: 'Доп. устройства временно недоступны',
  period_ends_soon: 'Период заканчивается меньше чем через час. Продлите тариф, затем добавьте устройство',
  max_addons: 'Достигнут максимум доп. устройств',
  not_enough_money: 'Недостаточно средств на балансе',
  create_failed: 'Не удалось подключить устройство, попробуйте ещё раз',
  nothing_to_cancel: 'Нет доп. устройств для отключения',
  bad_target: 'Этот тариф недоступен для перехода',
  already_on_target: 'Этот тариф уже подключён',
  already_family: 'Семейный тариф уже подключён',
  upgrade_failed: 'Не удалось сменить тариф, напишите в поддержку',
}

export class TariffError extends Error {
  code: string
  constructor(code: string) {
    super(ERRORS[code] ?? 'Ошибка биллинга, попробуйте позже')
    this.code = code
  }
}

export function parseTemplateResponse<T>(raw: unknown): T {
  let body = raw
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { throw new TariffError('bad_response') }
  }
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (!obj.ok) throw new TariffError(String(obj.error ?? 'bad_response'))
  return obj as T
}

async function callTemplate<T>(name: string, params: Record<string, string | number>): Promise<T> {
  try {
    const resp = await shm.get(`/template/${name}`, { params })
    return parseTemplateResponse<T>(resp.data)
  } catch (e) {
    if (e instanceof TariffError) throw e
    // 400 от SHM (ошибка рендера шаблона) или сеть — без деталей наружу.
    throw new TariffError('bad_response')
  }
}

export const fetchTariffInfo = (usi: number, catalogIds: number[] = []) =>
  callTemplate<TariffInfo>('tariff_info', { usi, ids: catalogIds.join(',') })

export const addonOrder = (usi: number, confirm = false) =>
  callTemplate<AddonQuote>('addon_device_order', confirm ? { usi, confirm: 1 } : { usi })

export const addonCancel = (usi: number, confirm = false) =>
  callTemplate<AddonCancelResult>('addon_device_cancel', confirm ? { usi, confirm: 1 } : { usi })

export const tariffUpgrade = (usi: number, service_id: number, confirm = false) =>
  callTemplate<UpgradeQuote>('tariff_upgrade', confirm ? { usi, service_id, confirm: 1 } : { usi, service_id })
