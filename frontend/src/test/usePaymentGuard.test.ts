import { describe, expect, it } from 'vitest'

import { decidePaymentAction, type ActivePayment } from '../hooks/usePaymentGuard'

const COOLDOWN = 60_000

describe('decidePaymentAction', () => {
  const active: ActivePayment = { key: 'yookassa:199', url: 'https://bill/x', openedAt: 1_000 }

  it('нет активной сессии → open (создаём новую)', () => {
    expect(decidePaymentAction(null, 'yookassa:199', 5_000, COOLDOWN)).toBe('open')
  })

  it('тот же key в пределах кулдауна → refocus (та же вкладка/ts, без нового charge)', () => {
    expect(decidePaymentAction(active, 'yookassa:199', 1_000 + 30_000, COOLDOWN)).toBe('refocus')
  })

  it('другой key, пока активна сессия → locked (не плодим параллельный платёж)', () => {
    expect(decidePaymentAction(active, 'yookassa:499', 1_000 + 30_000, COOLDOWN)).toBe('locked')
    expect(decidePaymentAction(active, 'sbp:199', 1_000 + 30_000, COOLDOWN)).toBe('locked')
  })

  it('кулдаун истёк → снова open даже для того же key', () => {
    expect(decidePaymentAction(active, 'yookassa:199', 1_000 + COOLDOWN, COOLDOWN)).toBe('open')
    expect(decidePaymentAction(active, 'yookassa:499', 1_000 + COOLDOWN + 1, COOLDOWN)).toBe('open')
  })
})
