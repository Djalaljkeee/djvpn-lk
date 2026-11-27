import { describe, expect, it } from 'vitest'

import { groupChildServices } from '../api/user'
import { parseTemplateResponse, TariffError, type TariffInfo } from '../api/tariffs'
import { effectiveDeviceLimit } from '../utils/deviceLimit'
import { normalizeUserService } from '../utils/normalizers'

const raw = (over: Record<string, unknown>) => ({
  user_service_id: 1, service_id: 3, status: 'ACTIVE', parent: null, service: { name: 'x' }, ...over,
})

describe('groupChildServices', () => {
  it('убирает доп. устройства из списка и кладёт их в addons тарифа', () => {
    const list = [
      raw({ user_service_id: 2363, service_id: 13, parent: 2359 }),
      raw({ user_service_id: 2362, service_id: 13, parent: 2359 }),
      raw({ user_service_id: 2359, service_id: 17 }),
    ].map(normalizeUserService)
    const roots = groupChildServices(list)
    expect(roots.map(s => s.id)).toEqual([2359])
    expect(roots[0].addons?.map(s => s.id)).toEqual([2363, 2362])
    // первая активная услуга — сам тариф, а не доп. устройство
    expect(roots.find(s => s.status === 1)?.service_id).toBe(17)
  })
})

describe('parseTemplateResponse', () => {
  it('принимает объект и строку JSON', () => {
    expect(parseTemplateResponse<{ ok: number; price: number }>({ ok: 1, price: 17.01 }).price).toBe(17.01)
    expect(parseTemplateResponse<{ ok: number; a: number }>('{"ok":1,"a":2}').a).toBe(2)
  })
  it('ошибку шаблона отдаёт с кодом и русским текстом', () => {
    try {
      parseTemplateResponse({ ok: 0, error: 'not_enough_money' })
      throw new Error('не бросил')
    } catch (e) {
      expect(e).toBeInstanceOf(TariffError)
      expect((e as TariffError).code).toBe('not_enough_money')
      expect((e as TariffError).message).toMatch(/Недостаточно/)
    }
  })
})

describe('effectiveDeviceLimit', () => {
  const info = (over: Partial<TariffInfo>) => ({ base_devices: 5, devices: 7, manual_limit: '', ...over }) as TariffInfo
  const remna = { user_service_id: 1, used_traffic_bytes: null, traffic_limit_bytes: null, limit_ip: null, hwid_device_limit: 0, online_at: null, locations: [] }
  it('тариф по устройствам: база + доп., даже пока в панели 0', () => {
    expect(effectiveDeviceLimit(info({}), remna)).toBe(7)
  })
  it('ручной лимит услуги главнее', () => {
    expect(effectiveDeviceLimit(info({ manual_limit: 15 }), remna)).toBe(15)
  })
  it('старый тариф без devices — как раньше, из панели/дефолт', () => {
    expect(effectiveDeviceLimit(info({ base_devices: 0 }), { ...remna, hwid_device_limit: 3 })).toBe(3)
    expect(effectiveDeviceLimit(null, remna)).toBe(5)
  })
})
