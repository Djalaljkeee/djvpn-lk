import { useEffect, useState } from 'react'
import { fetchPaySystemsV2, type PaySystemV2 } from '../api/services'
import { fetchPayments, fetchProfile, applyPromoCode } from '../api/user'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { Payment, PromoApplyResult } from '../types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const QUICK_AMOUNTS = [100, 300, 500, 1000]

export default function PaymentsPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [paySystems, setPaySystems] = useState<PaySystemV2[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedPs, setSelectedPs] = useState<PaySystemV2 | null>(null)
  const [amount, setAmount] = useState('300')
  const [promoCode, setPromoCode] = useState('')
  const [promoLoading, setPromoLoading] = useState(false)
  const [promoState, setPromoState] = useState<PromoApplyResult | null>(null)

  useEffect(() => {
    Promise.all([
      fetchPaySystemsV2().then(data => {
        setPaySystems(data)
        if (data[0]) setSelectedPs(data[0])
      }),
      fetchPayments().then(setPayments),
      fetchProfile().then(setUser),
    ])
      .catch(() => show('Ошибка загрузки данных', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const parsedAmount = parseFloat(amount) || 0
  const amountValid = parsedAmount >= 1
  const balance = user?.balance ?? 0

  const handlePay = () => {
    if (!selectedPs || !amountValid) return
    const url = selectedPs.shm_url + parsedAmount.toFixed(2)
    window.open(url, '_blank')
  }

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

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="brand-panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm uppercase tracking-[0.35em] text-fuchsia-100/70">Баланс и оплата</div>
            <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Пополнение баланса и управление промокодами.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              Быстро пополняйте счет, выбирайте удобную платежную систему и сразу видите результат применения промокода.
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-white/10 bg-white/5 px-5 py-4 sm:min-w-[260px]">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Текущий баланс</div>
            <div className="mt-2 text-4xl font-bold text-white">{balance.toFixed(0)} ₽</div>
            <div className="mt-2 text-sm text-slate-300">Основной баланс: {balance.toFixed(2)} ₽</div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="glass rounded-[2rem] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Пополнить счет</h2>
              <p className="mt-1 text-sm text-slate-300">Быстрые суммы и выбор платежной системы без лишних шагов.</p>
            </div>
            <div className="hidden rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200 sm:block">
              {paySystems.length || 0} платежных систем
            </div>
          </div>

          {loading ? (
            <div className="mt-5 space-y-3 animate-pulse">
              <div className="h-12 rounded-2xl bg-white/5" />
              <div className="h-12 rounded-2xl bg-white/5" />
              <div className="h-12 rounded-2xl bg-white/5" />
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {QUICK_AMOUNTS.map(value => (
                  <button
                    key={value}
                    onClick={() => setAmount(String(value))}
                    className={`rounded-2xl border px-4 py-3 text-sm font-medium transition-all ${
                      parsedAmount === value
                        ? 'border-brand-300/50 bg-brand-500/20 text-white'
                        : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    {value} ₽
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-sm text-slate-200">Сумма пополнения</label>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="Введите сумму"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-brand-300/50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-300">₽</span>
                </div>
              </div>

              {paySystems.length > 0 ? (
                <div className="space-y-2">
                  <label className="text-sm text-slate-200">Платежная система</label>
                  <div className="relative">
                    <select
                      value={selectedPs?.name ?? ''}
                      onChange={e => setSelectedPs(paySystems.find(ps => ps.name === e.target.value) ?? null)}
                      className="w-full appearance-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none focus:border-brand-300/50"
                    >
                      {paySystems.map(ps => <option key={ps.name} value={ps.name}>{ps.name}</option>)}
                    </select>
                    <svg className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
                  Платежные системы пока не настроены.
                </div>
              )}

              {selectedPs && (
                <button
                  onClick={handlePay}
                  disabled={!amountValid}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-4 text-sm font-semibold text-white shadow-brand disabled:opacity-50"
                >
                  Пополнить на {parsedAmount.toFixed(0)} ₽ через {selectedPs.name}
                </button>
              )}
            </div>
          )}
        </section>

        <section className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Промокод</h2>
          <p className="mt-1 text-sm text-slate-300">
            Статус промокода отображается прямо на странице. Если SHM не отдает текущее состояние, показываем результат последнего применения в этой сессии.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={promoCode}
              onChange={e => setPromoCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePromo()}
              placeholder="Введите промокод"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none focus:border-brand-300/50"
            />
            <button
              onClick={handlePromo}
              disabled={!promoCode.trim() || promoLoading}
              className="flex min-w-[156px] items-center justify-center gap-2 rounded-2xl bg-brand-500/20 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {promoLoading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
              Применить
            </button>
          </div>

          <div className={`mt-4 rounded-2xl border px-4 py-4 text-sm ${
            promoState
              ? promoState.ok
                ? 'border-emerald-300/20 bg-emerald-500/12 text-emerald-50'
                : 'border-rose-300/20 bg-rose-500/12 text-rose-50'
              : 'border-white/10 bg-white/5 text-slate-300'
          }`}>
            {promoState ? (
              <>
                <div className="font-semibold">{promoState.ok ? 'Промокод применен' : 'Промокод не принят'}</div>
                <div className="mt-1 leading-6">{promoState.message}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.18em] opacity-80">Код: {promoState.code}</div>
              </>
            ) : (
              <>
                <div className="font-semibold text-white">Статус пока неизвестен</div>
                <div className="mt-1 leading-6">После успешного применения здесь появится заметный статус вместо одноразового toast-сообщения.</div>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="glass rounded-[2rem] overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-xl font-semibold text-white">Последние транзакции</h2>
            <p className="mt-1 text-sm text-slate-300">Показываем до 20 последних операций по счету.</p>
          </div>
          <div className="rounded-2xl bg-white/5 px-4 py-2 text-sm text-slate-200">{payments.length} операций</div>
        </div>

        {payments.length > 0 ? (
          <div className="border-t border-white/10">
            {payments.slice(0, 20).map((pay, idx) => (
              <div key={pay.id ?? idx} className="flex flex-col gap-2 border-b border-white/5 px-5 py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {pay.pay_system_name && typeof pay.pay_system_name === 'string' && isNaN(Number(pay.pay_system_name))
                      ? pay.pay_system_name
                      : (pay.amount ?? 0) >= 0 ? 'Пополнение' : 'Списание'}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">
                    {pay.created ? format(parseISO(pay.created.replace(' ', 'T')), 'd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                    {pay.comment && ` · ${pay.comment}`}
                  </div>
                </div>
                <div className={`text-sm font-semibold ${(pay.amount ?? 0) >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
                  {(pay.amount ?? 0) >= 0 ? '+' : ''}{(pay.amount ?? 0).toFixed(2)} ₽
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-t border-white/10 px-5 py-10 text-center text-sm text-slate-300 sm:px-6">
            История платежей пока пуста.
          </div>
        )}
      </section>
    </div>
  )
}
