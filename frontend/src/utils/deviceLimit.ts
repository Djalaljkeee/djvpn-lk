import type { RemnaUserInfo } from '../types'
import type { TariffInfo } from '../api/tariffs'

/** Первое положительное значение лимита устройств: hwid → limitIp → дефолт.
 *  0/null в Remnawave означает «не задано» (например, HWID-лимит отключён),
 *  поэтому такие значения пропускаем, иначе `??` закоротил бы на 0. */
export function resolveDeviceLimit(
  remna: RemnaUserInfo | null | undefined,
  fallback = 5,
): number {
  const hwid = remna?.hwid_device_limit
  if (typeof hwid === 'number' && hwid > 0) return hwid
  const ip = remna?.limit_ip
  if (typeof ip === 'number' && ip > 0) return ip
  return fallback
}

/** Лимит устройств с учётом тарифа по устройствам: ручной лимит услуги →
 *  устройства тарифа + доп. устройства из SHM (tariff_info) → Remnawave.
 *  Пока лимит в панели не включён (hwid_enforce=0), Remnawave отдаёт 0 —
 *  поэтому SHM здесь главнее панели. */
export function effectiveDeviceLimit(
  info: TariffInfo | null | undefined,
  remna: RemnaUserInfo | null | undefined,
): number {
  if (info && typeof info.manual_limit === 'number' && info.manual_limit > 0) return info.manual_limit
  if (info && info.base_devices > 0) return info.devices
  return resolveDeviceLimit(remna)
}
