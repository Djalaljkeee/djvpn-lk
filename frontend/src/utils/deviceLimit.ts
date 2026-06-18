import type { RemnaUserInfo } from '../types'

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
