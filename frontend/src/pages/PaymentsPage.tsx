import { useEffect, useState } from 'react'
import { fetchPaySystemsV2, type PaySystemV2 } from '../api/services'
import { fetchPayments, fetchProfile, applyPromoCode } from '../api/user'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { Payment } from '../types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const QUICK_AMOUNTS = [100, 300, 500, 1000]

export default function PaymentsPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [paySystems, setPaySystems] = useState<PaySystemV2[]>([])
  const [payments,   setPayments]   = useState<Payment[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selectedPs, setSelectedPs] = useState<PaySystemV2 | null>(null)
  const [amount,     setAmount]     = useState('300')
  const [promoCode,  setPromoCode]  = useState('')
  const [promoLoading, setPromoLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchPaySystemsV2().then(data => { setPaySystems(data); if (data[0]) setSelectedPs(data[0]) }),
      fetchPayments().then(setPayments),
      fetchProfile().then(setUser),
    ])
      .catch(() => show('Ошибка загрузки данных', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const parsedAmount = parseFloat(amount) || 0
  const amountValid  = parsedAmount >= 1

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
      await applyPromoCode(code)
      show('Промокод применён!', 'success')
      setPromoCode('')
      fetchProfile().then(setUser)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Промокод не найден или уже использован', 'error')
    } finally {
      setPromoLoading(false)
    }
  }

  const balance = user?.balance ?? 0

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white">Баланс</h1>
      </div>

      {/* Balance hero */}
      <div className="glass rounded-2xl p-6 text-center bg-gradient-to-br from-brand-600/10 to-purple-600/5">
        <p className="text-5xl font-bold font-mono text-white mb-3">{balance.toFixed(0)} ₽</p>
        <div className="flex items-center justify-center gap-6 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            основной {balance.toFixed(2)} ₽
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            бонусный 0 ₽
          </span>
        </div>
      </div>

      {/* Top up section */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
          <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="font-semibold text-white text-sm">Пополнить счёт</span>
        </div>

        <div className="p-5 space-y-4">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-12 bg-surface-3 rounded-xl" />
              <div className="h-12 bg-surface-3 rounded-xl" />
              <div className="h-12 bg-surface-3 rounded-xl" />
            </div>
          ) : (
            <>
              {/* Amount input */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  {QUICK_AMOUNTS.map(v => (
                    <button key={v} onClick={() => setAmount(String(v))}
                      className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all border ${
                        parsedAmount === v
                          ? 'bg-brand-600/25 border-brand-500/50 text-brand-300'
                          : 'bg-surface-3 border-white/8 text-slate-400 hover:text-white hover:border-white/20'
                      }`}>
                      {v} ₽
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="Введите сумму"
                    className="w-full bg-surface-3 border border-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/40 transition-all pr-10"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">₽</span>
                </div>
              </div>

              {/* Pay system selector */}
              {paySystems.length > 0 ? (
                <div className="relative">
                  <select
                    value={selectedPs?.name ?? ''}
                    onChange={e => setSelectedPs(paySystems.find(p => p.name === e.target.value) ?? null)}
                    className="w-full appearance-none bg-surface-3 border border-white/8 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-brand-500/40 transition-all pr-10 cursor-pointer"
                  >
                    {paySystems.map(ps => (
                      <option key={ps.name} value={ps.name}>{ps.name}</option>
                    ))}
                  </select>
                  <svg className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-2">Платёжные системы не настроены</p>
              )}

              {/* Pay button */}
              {selectedPs && (
                <button onClick={handlePay} disabled={!amountValid}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-brand-600/25 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                  </svg>
                  Пополнить на {parsedAmount.toFixed(0)} ₽ через {selectedPs.name}
                </button>
              )}

              {/* Promo code */}
              <div className="pt-1 border-t border-white/5">
                <p className="text-xs text-slate-500 mb-2 font-medium">Промокод</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={e => setPromoCode(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePromo()}
                    placeholder="Введите промокод"
                    className="flex-1 bg-surface-3 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/40 transition-all"
                  />
                  <button
                    onClick={handlePromo}
                    disabled={!promoCode.trim() || promoLoading}
                    className="px-4 py-2.5 rounded-xl bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 text-sm font-medium border border-brand-600/25 transition-all disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {promoLoading
                      ? <span className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                      : 'Применить'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transactions */}
      <div className="glass rounded-2xl overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-white"
          onClick={() => {}}
        >
          <span>Последние транзакции</span>
          <span className="text-xs text-slate-500 font-normal">{payments.length} транзакций</span>
        </button>

        {payments.length > 0 && (
          <div className="border-t border-white/5">
            {payments.slice(0, 20).map((pay, idx) => (
              <div key={pay.id ?? idx} className="flex items-center justify-between gap-3 px-5 py-3 border-b border-white/4 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {pay.pay_system_name && typeof pay.pay_system_name === 'string' && isNaN(Number(pay.pay_system_name))
                      ? pay.pay_system_name
                      : (pay.amount ?? 0) >= 0 ? 'Пополнение' : 'Списание'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pay.created ? format(parseISO(pay.created.replace(' ', 'T')), 'd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                    {pay.comment && ` · ${pay.comment}`}
                  </p>
                </div>
                <span className={`text-sm font-mono font-semibold flex-shrink-0 ${
                  (pay.amount ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {(pay.amount ?? 0) >= 0 ? '+' : ''}{(pay.amount ?? 0).toFixed(2)} ₽
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
