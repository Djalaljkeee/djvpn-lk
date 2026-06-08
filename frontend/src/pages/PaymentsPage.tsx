import { useState } from 'react'
import { applyPromoCode } from '../api/user'
import { buildPaymentUrl } from '../api/services'
import { useToast } from '../components/Toast'
import { useDashboard, useDashboardSlice, useInvalidateDashboard } from '../hooks/useDashboard'
import type { PromoApplyResult } from '../types'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ru } from 'date-fns/locale'

export default function PaymentsPage() {
  const { show } = useToast()
  const { data, loading: dashLoading } = useDashboard()
  const invalidate = useInvalidateDashboard()
  const paySystems = useDashboardSlice(d => d?.paysystems ?? [])
  const payments = useDashboardSlice(d => d?.payments ?? [])
  const forecast = useDashboardSlice(d => d?.forecast?.data ?? [])
  const balance = useDashboardSlice(d => d?.profile?.balance ?? 0)
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoState, setPromoState] = useState<PromoApplyResult | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const suggestedAmounts = [199, 499, 899, 1599]
  const loading = dashLoading && !data

  const buildPayUrl = (ps: { shm_url?: string; paysystem?: string; name: string }) => {
    const n = Number(amount)
    // Если SHM /user/pay/paysystems вернул готовый shm_url — подставляем сумму
    // в существующий query. Иначе строим URL сами через buildPaymentUrl
    // (формат: https://bill.djvpn.ru/shm/pay_systems/{ps}.cgi?action=create&...).
    if (ps.shm_url) {
      if (!Number.isFinite(n) || n <= 0) return ps.shm_url
      const [base, query = ''] = ps.shm_url.split('?')
      const params = new URLSearchParams(query)
      params.set('amount', String(n))
      return `${base}?${params.toString()}`
    }
    return buildPaymentUrl({
      ps: ps.paysystem || ps.name,
      amount: Number.isFinite(n) && n > 0 ? n : 0,
    })
  }

  const forecastEntry = forecast[0] ?? null
  const bonuses = forecastEntry?.bonuses ?? 0
  const forecastItems = forecastEntry?.items ?? []

  // Тарифы с предстоящим продлением (у которых есть next-период).
  const upcomingItems = forecastItems.filter(item => item.next)
  // Номинальная сумма (цена без скидки) — крупное число в шапке и в строках тарифов.
  const nominalTotal = upcomingItems.reduce((sum, item) => sum + (item.next!.cost ?? 0), 0)
  // Реально к списанию при продлении (со скидкой) — строка-итог и проверка средств.
  const chargedTotal = upcomingItems.reduce((sum, item) => sum + (item.next!.total ?? 0), 0)

  const nearestItem = forecastItems
    .filter(item => item.expire && item.status === 'ACTIVE')
    .sort((a, b) =>
      new Date(a.expire!.replace(' ', 'T')).getTime() - new Date(b.expire!.replace(' ', 'T')).getTime()
    )[0] ?? null

  const daysUntilPayment = nearestItem?.expire
    ? differenceInDays(parseISO(nearestItem.expire.replace(' ', 'T')), new Date())
    : null

  const needsTopUp = chargedTotal > 0 && balance < chargedTotal

  const handlePromo = async () => {
    const code = promoCode.trim()
    if (!code) return
    setPromoLoading(true)
    try {
      const result = await applyPromoCode(code)
      setPromoState(result)
      setPromoCode('')
      await invalidate()
      show(result.message || 'Промокод применен', 'success')
    } catch (e: any) {
      const detail = e?.response?.data?.detail || 'Промокод не найден или уже использован'
      setPromoState({ ok: false, status: 400, message: detail, code })
      show(detail, 'error')
    } finally {
      setPromoLoading(false)
    }
  }

  const daysLabel = () => {
    if (daysUntilPayment === null) return 'Предстоящие платежи'
    if (daysUntilPayment <= 0) return 'Оплата просрочена'
    if (daysUntilPayment === 1) return 'Списание завтра'
    return `Списание через ${daysUntilPayment} дн.`
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="px-1 text-3xl font-bold text-white">Баланс</h1>

      {/* Balance card */}
      <section className="glass rounded-[2rem] p-5">
        <div className="text-sm text-slate-400">Текущий баланс</div>
        <div className="mt-1 text-4xl font-bold text-white">{balance.toFixed(2)} ₽</div>
        {bonuses > 0 && (
          <div className="mt-2 text-sm text-fuchsia-300">Бонусный баланс: {bonuses.toFixed(2)} ₽</div>
        )}
      </section>

      {/* Upcoming expenses */}
      {forecastEntry && upcomingItems.length > 0 && (
        <section className={`rounded-[2rem] p-5 ${
          daysUntilPayment !== null && daysUntilPayment <= 3
            ? 'border border-amber-300/20 bg-amber-500/10'
            : 'glass'
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-300/70">{daysLabel()}</div>
                <h2 className="text-lg font-semibold text-white">Предстоящие расходы</h2>
              </div>
            </div>
            <div className="shrink-0 text-2xl font-bold text-white">{nominalTotal.toFixed(0)} ₽</div>
          </div>

          <div className="mt-3 space-y-2">
            {upcomingItems.map((item, idx) => (
              <div key={item.user_service_id || item.usi || idx} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 truncate text-sm font-medium text-white">{item.name}</div>
                  <div className="flex shrink-0 items-baseline gap-2">
                    {item.expire && (
                      <span className="text-xs text-slate-400">
                        {format(parseISO(item.expire.replace(' ', 'T')), 'd MMMM', { locale: ru })}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-white">{item.next!.cost.toFixed(2)} ₽</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm text-amber-100">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
            <span>Будет списано при продлении: <span className="font-semibold">{chargedTotal.toFixed(2)} ₽</span></span>
          </div>

          {needsTopUp && (
            <div className="mt-3 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
              Недостаточно средств. Пополните баланс на{' '}
              <span className="font-semibold">{(chargedTotal - balance).toFixed(0)} ₽</span>
            </div>
          )}
        </section>
      )}

      {/* Promo code */}
      <section className="glass rounded-[2rem] p-5">
        <h2 className="mb-4 text-xl font-semibold text-white">Промокод</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={promoCode}
            onChange={e => setPromoCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handlePromo()}
            placeholder="Введите промокод"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-brand-300/50"
          />
          <button
            onClick={handlePromo}
            disabled={!promoCode.trim() || promoLoading}
            className="flex items-center justify-center gap-2 rounded-2xl bg-blue-500 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {promoLoading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            Активировать
          </button>
        </div>
        {promoState && (
          <div className={`mt-3 rounded-2xl border px-4 py-3 text-sm ${
            promoState.ok
              ? 'border-emerald-300/20 bg-emerald-500/10 text-emerald-100'
              : 'border-rose-300/20 bg-rose-500/10 text-rose-100'
          }`}>
            <div className="font-semibold">{promoState.ok ? 'Промокод применен' : 'Ошибка'}</div>
            <div className="mt-0.5">{promoState.message}</div>
          </div>
        )}
      </section>

      {/* Top-up: payment systems */}
      <section className="glass rounded-[2rem] p-5">
        <h2 className="mb-4 text-xl font-semibold text-white">Пополнение баланса</h2>

        <div className="mb-4 space-y-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Сумма пополнения, ₽"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-brand-300/50"
          />
          <div className="flex flex-wrap gap-2">
            {suggestedAmounts.map(v => (
              <button
                key={v}
                onClick={() => setAmount(String(v))}
                className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition-colors ${
                  amount === String(v)
                    ? 'border-brand-300/60 bg-brand-500/20 text-white'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {v} ₽
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-16 rounded-2xl bg-white/5" />
            <div className="h-16 rounded-2xl bg-white/5" />
          </div>
        ) : paySystems.length > 0 ? (
          <div className="space-y-2">
            {paySystems.map(ps => (
              <button
                key={ps.name}
                onClick={() => window.open(buildPayUrl(ps), '_blank')}
                className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-3 text-left transition-colors"
              >
                <div className="font-medium text-white">{ps.name}</div>
                {ps.paysystem && (
                  <div className="mt-0.5 text-xs text-slate-400">Оплата через {ps.paysystem}</div>
                )}
                {(ps.min_sum || ps.max_sum) && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    {ps.min_sum ? `${ps.min_sum.toFixed(0)}` : ''}
                    {ps.min_sum && ps.max_sum ? ' – ' : ''}
                    {ps.max_sum ? `${ps.max_sum.toFixed(0)} ₽` : '₽'}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
            Платежные системы пока не настроены.
          </div>
        )}
      </section>

      {/* Transaction history */}
      <section className="glass rounded-[2rem] overflow-hidden">
        <button
          onClick={() => setHistoryOpen(v => !v)}
          className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
        >
          <h2 className="text-xl font-semibold text-white">История операций</h2>
          <svg
            className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {historyOpen && (
          payments.length > 0 ? (
            <div className="border-t border-white/10">
              {payments.slice(0, 20).map((pay, idx) => (
                <div key={pay.id ?? idx} className="flex items-center justify-between gap-4 border-b border-white/5 px-5 py-3 last:border-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {pay.pay_system_name && typeof pay.pay_system_name === 'string' && isNaN(Number(pay.pay_system_name))
                        ? pay.pay_system_name
                        : (pay.amount ?? 0) >= 0 ? 'Пополнение' : 'Списание'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {pay.created ? format(parseISO(pay.created.replace(' ', 'T')), 'd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                      {pay.comment && ` · ${pay.comment}`}
                    </div>
                  </div>
                  <div className={`shrink-0 text-sm font-semibold ${(pay.amount ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {(pay.amount ?? 0) >= 0 ? '+' : ''}{(pay.amount ?? 0).toFixed(2)} ₽
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-t border-white/10 px-5 py-8 text-center text-sm text-slate-400">
              История платежей пока пуста.
            </div>
          )
        )}
      </section>
    </div>
  )
}
