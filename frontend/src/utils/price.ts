import type { Service } from '../types'

export interface ServicePrice {
  // Номинал тарифа, без скидки.
  base: number
  // Сумма, которую реально спишет биллинг.
  final: number
  // Процент персональной скидки (0 — скидки нет или услуга с `no_discount`).
  percent: number
  hasDiscount: boolean
}

/**
 * Цена услуги для отображения. Источник правды — поля `real_cost`/`discount`
 * из прайс-листа SHM, а не собственный пересчёт: так ЛК не расходится с
 * биллингом на услугах, где скидка не действует.
 *
 * `hasDiscount` требует и процент, и реальную разницу в цене: SHM может
 * вернуть процент, но нулевую разницу на бесплатной услуге — рисовать
 * «−50%» над «0 ₽» смысла нет.
 */
export function servicePrice(svc: Pick<Service, 'cost' | 'discount' | 'real_cost'>): ServicePrice {
  const base = Number.isFinite(svc.cost) ? svc.cost : 0
  const percent = Number.isFinite(svc.discount) ? svc.discount : 0
  const final = Number.isFinite(svc.real_cost) ? svc.real_cost : base

  return {
    base,
    final,
    percent,
    hasDiscount: percent > 0 && final < base,
  }
}

/**
 * Цена в рублях: целые — без дробной части, со скидкой возможны копейки
 * (250 ₽ и скидка 15% → 212.5 ₽). Хвостовые нули не показываем.
 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, '')
}
