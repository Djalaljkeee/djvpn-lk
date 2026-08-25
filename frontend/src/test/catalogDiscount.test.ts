import { describe, expect, it } from 'vitest'

import { normalizeCatalogService } from '../utils/normalizers'
import { servicePrice, formatPrice } from '../utils/price'

// Позиция прайс-листа SHM (GET /shm/v1/service/order → Core::Service::price_list).
// Поля discount/cost_discount/real_cost SHM считает сам по users.discount.
const shmRow = (over: Record<string, unknown> = {}) => ({
  id: 12,
  name: 'DJ VPN 1 месяц',
  cost: 250,
  discount: 15,
  cost_discount: 37.5,
  real_cost: 212.5,
  real_cost_with_bonuses: 212.5,
  cost_bonus: 0,
  period_cost: 1,
  period_type: 'month',
  allow_to_order: 1,
  ...over,
})

describe('normalizeCatalogService: персональная скидка', () => {
  it('прокидывает discount и real_cost из ответа SHM', () => {
    const svc = normalizeCatalogService(shmRow())
    expect(svc.cost).toBe(250)
    expect(svc.discount).toBe(15)
    expect(svc.real_cost).toBe(212.5)
  })

  it('без скидки real_cost равен номиналу', () => {
    const svc = normalizeCatalogService(shmRow({ discount: 0, cost_discount: 0, real_cost: 250 }))
    expect(svc.discount).toBe(0)
    expect(svc.real_cost).toBe(250)
  })

  it('услуга с no_discount: SHM отдаёт discount 0, даже если скидка у юзера есть', () => {
    const svc = normalizeCatalogService(shmRow({ discount: 0, real_cost: 250, no_discount: 1 }))
    expect(servicePrice(svc).hasDiscount).toBe(false)
    expect(servicePrice(svc).final).toBe(250)
  })

  it('старый SHM без полей скидки — фолбэк на номинал, а не на 0', () => {
    const { discount, real_cost, cost_discount, ...legacy } = shmRow()
    const svc = normalizeCatalogService(legacy)
    expect(svc.discount).toBe(0)
    expect(svc.real_cost).toBe(250)
  })

  it('строковые числа из Perl-сериализации приводятся к number', () => {
    const svc = normalizeCatalogService(shmRow({ cost: '250', discount: '15', real_cost: '212.5' }))
    expect(svc.real_cost).toBe(212.5)
    expect(svc.discount).toBe(15)
  })
})

describe('servicePrice', () => {
  it('к списанию идёт цена со скидкой, номинал сохраняется для зачёркивания', () => {
    const price = servicePrice({ cost: 250, discount: 15, real_cost: 212.5 })
    expect(price).toEqual({ base: 250, final: 212.5, percent: 15, hasDiscount: true })
  })

  it('скидка 100%: услуга бесплатна, скидку показываем', () => {
    const price = servicePrice({ cost: 250, discount: 100, real_cost: 0 })
    expect(price.final).toBe(0)
    expect(price.hasDiscount).toBe(true)
  })

  it('бесплатная услуга: процент есть, а разницы в цене нет — плашку не рисуем', () => {
    const price = servicePrice({ cost: 0, discount: 50, real_cost: 0 })
    expect(price.hasDiscount).toBe(false)
  })
})

describe('formatPrice', () => {
  it.each([
    [250, '250'],
    [212.5, '212.5'],
    [212.55, '212.55'],
    [212.05, '212.05'],
    [0, '0'],
  ])('%s → %s', (input, expected) => {
    expect(formatPrice(input)).toBe(expected)
  })
})
