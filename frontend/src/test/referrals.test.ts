import { describe, expect, it } from 'vitest'

import { aggregateReferrals } from '../api/user'

describe('aggregateReferrals', () => {
  it('суммирует income и берёт total из маркера {total}', () => {
    const stats = aggregateReferrals([
      { user_id: 10, login: '@a', income: 150 },
      { user_id: 11, login: '@b', income: 75.5 },
      { total: 2 },
    ])
    expect(stats.total_referrals).toBe(2)
    expect(stats.total_income).toBeCloseTo(225.5)
    expect(stats.items).toBe(2)
    expect(stats.referrals).toHaveLength(2)
  })

  it('падает на длину списка, если SHM не прислал {total}', () => {
    const stats = aggregateReferrals([
      { user_id: 10, income: 50 },
      { user_id: 11, income: 25 },
    ])
    expect(stats.total_referrals).toBe(2)
    expect(stats.total_income).toBe(75)
  })

  it('строки в income не ломают сумму', () => {
    const stats = aggregateReferrals([
      { user_id: 10, income: '12.50' },
      { user_id: 11, income: 'не число' },
    ])
    expect(stats.total_income).toBe(12.5)
  })

  it('пустой ответ → нули, не undefined', () => {
    const stats = aggregateReferrals([])
    expect(stats).toEqual({
      total_referrals: 0,
      total_income: 0,
      items: 0,
      referrals: [],
    })
  })
})
