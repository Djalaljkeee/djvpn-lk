import { describe, expect, it, vi } from 'vitest'

import { normalizeReferralStats } from '../api/user'

describe('normalizeReferralStats', () => {
  it('мапит полный ответ SHM-шаблона (items + агрегаты)', () => {
    const stats = normalizeReferralStats({
      user_id: 2,
      commission: 20,
      total_referrals: 2,
      total_paid: 3681.95,
      total_income: 736.39,
      items: [
        { user_id: 11, name: 'Sergey', created: '2025-04-12', paid: 3606.45, income: 721.29 },
        { user_id: 21, name: 'М.В.', paid: 75.5, income: 15.1 },
      ],
    })
    expect(stats.commission).toBe(20)
    expect(stats.total_referrals).toBe(2)
    expect(stats.total_paid).toBeCloseTo(3681.95)
    expect(stats.total_income).toBeCloseTo(736.39)
    expect(stats.referrals).toHaveLength(2)
    expect(stats.referrals[0]).toEqual({
      user_id: 11, name: 'Sergey', created: '2025-04-12', paid: 3606.45, income: 721.29,
    })
    // created опционально — у второго реферала его нет
    expect(stats.referrals[1].created).toBeUndefined()
  })

  it('отсутствует commission → fallback 15 и warn, без падения', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = normalizeReferralStats({
      total_referrals: 1,
      total_paid: 100,
      total_income: 15,
      items: [{ user_id: 5, name: 'Тест', paid: 100, income: 15 }],
    })
    expect(stats.commission).toBe(15)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('пустой items → нули и пустой список, total_referrals = 0', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      total_referrals: 0,
      total_paid: 0,
      total_income: 0,
      items: [],
    })
    expect(stats.referrals).toEqual([])
    expect(stats.total_referrals).toBe(0)
    expect(stats.total_paid).toBe(0)
    expect(stats.total_income).toBe(0)
  })

  it('строковые числа в paid/income/total_paid → Number, NaN не утекает', () => {
    const stats = normalizeReferralStats({
      commission: '20',
      total_referrals: '2',
      total_paid: '3606.45',
      total_income: 'не число',
      items: [
        { user_id: 11, paid: '3606.45', income: '721.29' },
        { user_id: 12, paid: 'мусор', income: null },
      ],
    })
    expect(stats.commission).toBe(20)
    expect(stats.total_referrals).toBe(2)
    expect(stats.total_paid).toBeCloseTo(3606.45)
    // total_income невалиден → 0, не NaN
    expect(stats.total_income).toBe(0)
    expect(stats.referrals[0].paid).toBeCloseTo(3606.45)
    expect(stats.referrals[0].income).toBeCloseTo(721.29)
    // мусор/null → 0
    expect(stats.referrals[1].paid).toBe(0)
    expect(stats.referrals[1].income).toBe(0)
  })

  it('total_referrals не прислан → берётся длина items', () => {
    const stats = normalizeReferralStats({
      commission: 20,
      items: [
        { user_id: 1, paid: 0, income: 0 },
        { user_id: 2, paid: 0, income: 0 },
        { user_id: 3, paid: 0, income: 0 },
      ],
    })
    expect(stats.total_referrals).toBe(3)
  })

  it('мусорный body (null/строка) → дефолтная пустая статистика, не падает', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stats = normalizeReferralStats(null)
    expect(stats).toEqual({
      user_id: undefined,
      commission: 15,
      total_referrals: 0,
      total_paid: 0,
      total_income: 0,
      referrals: [],
    })
    warn.mockRestore()
  })
})

describe('normalizeReferralStats — Telegram-message format (поле text)', () => {
  // Реальный ответ SHM /public/refferalslist?format=html&user_id=2 (усечён).
  const realResponse = {
    chat_id: 345522691,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ callback_data: '/menu', text: '📖 В меню' }]] },
    text: '\r\n🤝 Ваши рефералы\r\nВсего приглашено: 50' +
      '1. Вероника — оплачено: 0₽ · ваш доход: 0₽' +
      '11. Sergey — оплачено: 3606.45₽ · ваш доход: 721.29₽' +
      '14. Тимерлан Абдушев — оплачено: 3315.98₽ · ваш доход: 663.196₽' +
      '36. 🌚 — оплачено: 0₽ · ваш доход: 0₽' +
      '49. jalal.abdullazade@yandex.ru — оплачено: 0₽ · ваш доход: 0₽' +
      '\r\n━━━━━━━━━━━━━━━━━━━━\r\n💰 Всего оплачено рефералами: 27304.88₽' +
      '\r\n🎁 Ваш доход (20%): 5460.976₽',
  }

  it('парсит имена (включая эмодзи/email), суммы и комиссию из строки text', () => {
    const stats = normalizeReferralStats(realResponse)
    expect(stats.commission).toBe(20)
    expect(stats.total_paid).toBeCloseTo(27304.88)
    expect(stats.total_income).toBeCloseTo(5460.976)
    expect(stats.total_referrals).toBe(5)
    // имя с дробным доходом
    const sergey = stats.referrals.find(r => r.name === 'Sergey')
    expect(sergey).toEqual({ name: 'Sergey', paid: 3606.45, income: 721.29 })
    // эмодзи-имя и email-имя не ломают разбор
    expect(stats.referrals.some(r => r.name === '🌚')).toBe(true)
    expect(stats.referrals.some(r => r.name === 'jalal.abdullazade@yandex.ru')).toBe(true)
  })

  it('срезает HTML-теги <b> в суммах', () => {
    const stats = normalizeReferralStats({
      text: '🤝 Ваши рефералы\nВсего приглашено: <b>1</b>' +
        '1. Тест — оплачено: <b>199</b>₽ · ваш доход: <b>39.8</b>₽' +
        '\n💰 Всего оплачено рефералами: <b>199</b>₽' +
        '\n🎁 Ваш доход (20%): <b>39.8</b>₽',
    })
    expect(stats.total_referrals).toBe(1)
    expect(stats.referrals[0]).toEqual({ name: 'Тест', paid: 199, income: 39.8 })
    expect(stats.total_paid).toBe(199)
    expect(stats.total_income).toBeCloseTo(39.8)
  })

  it('пустой text («никого нет») → нули, commission fallback 15', () => {
    const stats = normalizeReferralStats({
      text: '🤝 Ваши рефералы\nПока никого нет. Поделитесь реферальной ссылкой.',
    })
    expect(stats.referrals).toEqual([])
    expect(stats.total_referrals).toBe(0)
    expect(stats.total_paid).toBe(0)
    expect(stats.total_income).toBe(0)
    expect(stats.commission).toBe(15)
  })

  it('структурированный items приоритетнее text, если оба присутствуют', () => {
    const stats = normalizeReferralStats({
      text: '1. Из текста — оплачено: 999₽ · ваш доход: 100₽',
      commission: 20,
      total_paid: 50,
      total_income: 10,
      items: [{ user_id: 7, name: 'Из JSON', paid: 50, income: 10 }],
    })
    expect(stats.referrals[0].name).toBe('Из JSON')
    expect(stats.total_paid).toBe(50)
  })
})
