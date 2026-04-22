import { useEffect, useState } from 'react'
import { fetchPaySystemsV2, type PaySystemV2 } from '../api/services'
import { fetchPayments, fetchProfile, applyPromoCode, fetchForecast } from '../api/user'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { Payment, PromoApplyResult, ForecastEntry } from '../types'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ru } from 'date-fns/locale'

export default function PaymentsPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [paySystems, setPaySystems] = useState<PaySystemV2[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoState, setPromoState] = useState<PromoApplyResult | null>(null)
  const [forecast, setForecast] = useState<ForecastEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const suggestedAmounts = [199, 499, 899, 1599]

  const buildPayUrl = (shm_url: string) => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return shm_url
    const [base, query = ''] = shm_url.split('?')
    const params = new URLSearchParams(query)
    params.set('amount', String(n))
    return `${base}?${params.toString()}`
  }

  useEffect(() => {
    Promise.all([
      fetchPaySystemsV2().then(setPaySystems),
      fetchPayments().then(setPayments),
      fetchProfile().then(setUser),
      fetchForecast().then(setForecast).catch(() => {}),
    ])
      .catch(() => show('Ошибка загрузки данных', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const balance = user?.balance ?? 0

  const forecastEntry = forecast[0] ?? null
  const bonuses = forecastEntry?.bonuses ?? 0
  const forecastTotal = forecastEntry?.total ?? 0
  const forecastItems = forecastEntry?.items ?? []

  const nearestItem = forecastItems
    .filter(item => item.expire && item.status === 'ACTIVE')
    .sort((a, b) =>
      new Date(a.expire!.replace(' ', 'T')).getTime() - new Date(b.expire!.replace(' ', 'T')).getTime()
    )[0] ?? null

  const daysUntilPayment = nearestItem?.expire
    ? differenceInDays(parseISO(nearestItem.expire.replace(' ', 'T')), new Date())
    : null

  const needsTopUp = forecastTotal > 0 && balance < forecastTotal

  const handlePromo = async () => {
    const code = promoCode.trim()
    if (!code) return
    setPromoLoading(true)
    try {
      const result = await applyPromoCode(code)
      setPromoState(result)
      setPromoCode('')
      const profile = await fetchProfile()
      setUser(profile)
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

      {/* Payment forecast */}
      {forecastEntry && forecastTotal > 0 && (
        <section className={`rounded-[2rem] p-5 ${
          daysUntilPayment !== null && daysUntilPayment <= 3
            ? 'border border-amber-300/20 bg-amber-500/10'
            : 'glass'
        }`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Прогноз списания</h2>
              <p className="mt-0.5 text-sm text-slate-300">{daysLabel()}</p>
            </div>
            <div className="rounded-2xl bg-white/10 px-4 py-2 text-lg font-bold text-white">
              {forecastTotal.toFixed(0)} ₽
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {forecastItems.filter(item => item.next).map((item, idx) => (
              <div key={item.user_service_id || item.usi || idx} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{item.name}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {item.next!.name}
                      {item.expire && (
                        <span className="ml-1.5">
                          · {format(parseISO(item.expire.replace(' ', 'T')), 'd MMM yyyy', { locale: ru })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-white">{item.next!.total.toFixed(0)} ₽</div>
                </div>
              </div>
            ))}
          </div>

          {needsTopUp && (
            <div className="mt-3 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
              Недостаточно средств. Пополните баланс на{' '}
              <span className="font-semibold">{(forecastTotal - balance).toFixed(0)} ₽</span>
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
                onClick={() => window.open(buildPayUrl(ps.shm_url), '_blank')}
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
