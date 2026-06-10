import { describe, expect, it, vi } from 'vitest'

import { normalizeReferralStats } from '../api/user'

describe('normalizeReferralStats', () => {
  // Реальный ответ SHM-шаблона /template/refferalslist?format=json (усечён до 3 записей).
  const realResponse = {
    user_id: 2,
    commission: 20,
    count: 50,
    total_paid: 27304.88,
    total_income: 5460.976,
    referrals: [
      { created: '2024-08-21 15:41:22', full_name: 'Вероника', income: 0, login: '@2117232290', paid: 0, user_id: 85 },
      { created: '2024-11-09 12:55:39', full_name: 'Sergey', income: 721.29, login: '@1037681877', paid: 3606.45, user_id: 178 },
      { created: '2026-05-03 10:10:43', full_name: '', income: 0, login: 'jalal.abdullazade@yandex.ru', paid: 0, user_id: 1145 },
    ],
  }

  it('мапит реальный JSON: count, total_paid, total_income, commission', () => {
    const stats = normalizeReferralStats(realResponse)
    expect(stats.user_id).toBe(2)
    expect(stats.commission).toBe(20)
    expect(stats.total_referrals).toBe(50)
    expect(stats.total_paid).toBeCloseTo(27304.88)
    expect(stats.total_income).toBeCloseTo(5460.976)
    expect(stats.referrals).toHaveLength(3)
  })

  it('каждая запись: user_id, name из full_name, login, paid/income, created', () => {
    const stats = normalizeReferralStats(realResponse)
    expect(stats.referrals[1]).toEqual({
      user_id: 178,
      name: 'Sergey',
      login: '@1037681877',
      created: '2024-11-09 12:55:39',
      paid: 3606.45,
      income: 721.29,
    })
  })

  it('пустой full_name → fallback name = login (email-юзер)', () => {
    const stats = normalizeReferralStats(realResponse)
    const emailUser = stats.referrals.find(r => r.user_id === 1145)!
    expect(emailUser.name).toBe('jalal.abdullazade@yandex.ru')
    expect(emailUser.login).toBe('jalal.abdullazade@yandex.ru')
  })

  it('commission отсутствует → fallback 15 + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = normalizeReferralStats({
      user_id: 5,
      count: 0,
      total_paid: 0,
      total_income: 0,
      referrals: [],
    })
    expect(stats.commission).toBe(15)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('count=0 и пустой массив → total_referrals=0, не падает', () => {
    const stats = normalizeReferralStats({
      user_id: 5,
      commission: 20,
      count: 0,
      total_paid: 0,
      total_income: 0,
      referrals: [],
    })
    expect(stats.referrals).toEqual([])
    expect(stats.total_referrals).toBe(0)
  })

  it('error-ответ {"error":"unauthorized"} → дефолтная пустая статистика', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = normalizeReferralStats({ error: 'unauthorized' })
    expect(stats.total_referrals).toBe(0)
    expect(stats.referrals).toEqual([])
    expect(stats.commission).toBe(15)
    warn.mockRestore()
  })

  it('строковые числа в paid/income/commission → Number, NaN не утекает', () => {
    const stats = normalizeReferralStats({
      commission: '20',
      count: '50',
      total_paid: '27304.88',
      total_income: 'мусор',
      referrals: [
        { user_id: '178', full_name: 'Sergey', paid: '3606.45', income: '721.29' },
        { user_id: 12, paid: null, income: undefined },
      ],
    })
    expect(stats.commission).toBe(20)
    expect(stats.total_referrals).toBe(50)
    expect(stats.total_paid).toBeCloseTo(27304.88)
    expect(stats.total_income).toBe(0)
    expect(stats.referrals[0].user_id).toBe(178)
    expect(stats.referrals[0].paid).toBeCloseTo(3606.45)
    expect(stats.referrals[1].paid).toBe(0)
    expect(stats.referrals[1].income).toBe(0)
  })

  it('legacy-формат items/name/total_referrals тоже принимается', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      total_referrals: 2,
      total_paid: 100,
      total_income: 20,
      items: [
        { user_id: 1, name: 'Alpha', paid: 100, income: 20 },
        { user_id: 2, name: 'Beta', paid: 0, income: 0 },
      ],
    })
    expect(stats.total_referrals).toBe(2)
    expect(stats.referrals).toHaveLength(2)
    expect(stats.referrals[0].name).toBe('Alpha')
  })

  it('count не прислан → берётся длина referrals', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      total_paid: 0,
      total_income: 0,
      referrals: [
        { user_id: 1, full_name: 'A', paid: 0, income: 0 },
        { user_id: 2, full_name: 'B', paid: 0, income: 0 },
        { user_id: 3, full_name: 'C', paid: 0, income: 0 },
      ],
    })
    expect(stats.total_referrals).toBe(3)
  })

  it('мусорный body (null) → дефолтная пустая статистика, не падает', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = normalizeReferralStats(null)
    expect(stats).toEqual({
      user_id: undefined,
      commission: 15,
      total_referrals: 0,
      total_paid: 0,
      total_income: 0,
      referrals: [],
      referrals_30d: 0,
      paid_30d: null,
      income_30d: null,
    })
    warn.mockRestore()
  })

  it('referrals_30d считается из created, опираясь на текущую дату', () => {
    const now = new Date('2026-06-10T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const stats = normalizeReferralStats({
        commission: 20,
        count: 3,
        total_paid: 0,
        total_income: 0,
        referrals: [
          { user_id: 1, full_name: 'recent', created: '2026-05-31 19:45:00', paid: 0, income: 0 },
          { user_id: 2, full_name: 'edge', created: '2026-05-12 00:00:00', paid: 0, income: 0 },
          { user_id: 3, full_name: 'old', created: '2025-01-01 00:00:00', paid: 0, income: 0 },
        ],
      })
      // 31 мая и 12 мая — внутри 30-дневного окна от 10 июня; 1 января 2025 — нет.
      expect(stats.referrals_30d).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('paid_30d и income_30d пробрасываются из ответа SHM как числа', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      count: 50,
      total_paid: 27304.88,
      total_income: 5460.976,
      paid_30d: 3860.22,
      income_30d: 716.45,
      referrals: [],
    })
    expect(stats.paid_30d).toBeCloseTo(3860.22)
    expect(stats.income_30d).toBeCloseTo(716.45)
  })

  it('paid_30d отсутствует → null (UI не рисует дельту)', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      count: 0,
      total_paid: 0,
      total_income: 0,
      referrals: [],
    })
    expect(stats.paid_30d).toBeNull()
    expect(stats.income_30d).toBeNull()
  })
})
