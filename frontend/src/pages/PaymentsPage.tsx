import { useEffect, useState } from 'react'
import { fetchPaySystems, createPayment } from '../api/services'
import { fetchPayments, fetchProfile } from '../api/user'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { PaySystem, Payment } from '../types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const QUICK_AMOUNTS = [100, 300, 500, 1000]

export default function PaymentsPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [paySystems, setPaySystems] = useState<PaySystem[]>([])
  const [payments,   setPayments]   = useState<Payment[]>([])
  const [loading,    setLoading]    = useState(true)
  const [selectedPs, setSelectedPs] = useState<number | null>(null)
  const [amount,     setAmount]     = useState('')
  const [paying,     setPaying]     = useState(false)
  const [payUrl,     setPayUrl]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchPaySystems().then(data => { setPaySystems(data); if (data[0]) setSelectedPs(data[0].pay_system_id) }),
      fetchPayments().then(setPayments),
      fetchProfile().then(setUser),
    ])
      .catch(() => show('Ошибка загрузки данных', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const selectedSystem = paySystems.find(p => p.pay_system_id === selectedPs)
  const minAmount = selectedSystem?.min_amount ?? 1
  const amountValid = !!amount && parseFloat(amount) >= minAmount

  const handlePay = async () => {
    if (!selectedPs || !amountValid) return
    setPaying(true)
    setPayUrl(null)
    try {
      const result = await createPayment(selectedPs, parseFloat(amount))
      const url = result?.data?.url || result?.url
      if (url) {
        setPayUrl(url)
        window.open(url, '_blank')
        show('Страница оплаты открыта', 'info')
      } else {
        show('Платёж создан', 'success')
      }
      await Promise.all([
        fetchProfile().then(setUser),
        fetchPayments().then(setPayments),
      ])
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка создания платежа', 'error')
    } finally {
      setPaying(false)
    }
  }

  const balance = user?.balance ?? 0

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold text-white">Пополнение баланса</h1>
        <p className="text-sm text-slate-500 mt-0.5">Выберите способ оплаты и укажите сумму</p>
      </div>

      {/* Balance hero */}
      <div className="glass rounded-2xl p-6 flex items-center gap-5 bg-gradient-to-br from-brand-600/12 to-purple-600/5">
        <div className="w-14 h-14 rounded-2xl bg-brand-600/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-7 h-7 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
          </svg>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">Текущий баланс</p>
          <p className="text-4xl font-bold font-mono gradient-text">{balance.toFixed(2)} ₽</p>
        </div>
      </div>

      {/* Payment form */}
      <div className="glass rounded-2xl p-5 space-y-5">
        <h2 className="font-semibold text-white">Пополнить</h2>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-24 bg-surface-3 rounded-xl" />
            <div className="h-11 bg-surface-3 rounded-xl" />
          </div>
        ) : paySystems.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center">Платёжные системы не настроены</p>
        ) : (
          <>
            {/* Pay system grid */}
            <div>
              <p className="text-xs text-slate-500 mb-2 font-medium">Способ оплаты</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {paySystems.map(ps => (
                  <button
                    key={ps.pay_system_id}
                    onClick={() => setSelectedPs(ps.pay_system_id)}
                    className={`px-3 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                      selectedPs === ps.pay_system_id
                        ? 'bg-brand-600/20 border-brand-500/40 text-brand-400'
                        : 'bg-surface-3 border-white/8 text-slate-400 hover:text-white hover:border-white/15'
                    }`}
                  >
                    <span className="block">{ps.name}</span>
                    {ps.currency && <span className="block text-xs opacity-60 mt-0.5">{ps.currency}</span>}
                    {ps.min_amount && <span className="block text-xs opacity-50 mt-0.5">от {ps.min_amount} ₽</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Amount input */}
            <div>
              <p className="text-xs text-slate-500 mb-2 font-medium">
                Сумма{selectedSystem?.min_amount ? ` (минимум ${selectedSystem.min_amount} ₽)` : ''}
              </p>
              <div className="flex gap-2 flex-wrap">
                {QUICK_AMOUNTS.map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    className={`px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
                      amount === String(v)
                        ? 'bg-brand-600/20 border-brand-500/30 text-brand-400'
                        : 'bg-surface-3 border-white/8 text-slate-400 hover:text-white'
                    }`}
                  >
                    {v} ₽
                  </button>
                ))}
                <div className="relative flex-1 min-w-[120px]">
                  <input
                    type="number"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="Своя сумма"
                    min={minAmount}
                    step="1"
                    className="w-full bg-surface-3 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 transition-all pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">₽</span>
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handlePay}
              disabled={!amountValid || paying}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-600/20 flex items-center justify-center gap-2"
            >
              {paying ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Создание платежа...
                </>
              ) : `Пополнить${amountValid ? ` на ${parseFloat(amount).toFixed(0)} ₽` : ''}`}
            </button>

            {payUrl && (
              <div className="p-3 rounded-xl bg-brand-600/10 border border-brand-600/20 text-xs text-brand-300 animate-fade-in">
                Если страница не открылась,{' '}
                <a href={payUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-brand-200">
                  нажмите здесь
                </a>
              </div>
            )}
          </>
        )}
      </div>

      {/* Payment history */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">История операций</h2>
        {payments.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="text-4xl mb-2">💳</div>
            <p className="text-slate-500 text-sm">История пуста</p>
          </div>
        ) : (
          <div className="space-y-2">
            {payments.slice(0, 30).map((pay, idx) => (
              <div key={pay.id ?? idx} className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-white font-medium truncate">
                    {pay.pay_system_name || ((pay.amount ?? 0) >= 0 ? 'Пополнение' : 'Списание')}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {pay.created ? format(parseISO(pay.created.replace(' ', 'T')), 'd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                    {pay.comment && ` · ${pay.comment}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-sm font-mono font-semibold ${
                    (pay.amount ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {(pay.amount ?? 0) >= 0 ? '+' : ''}{(pay.amount ?? 0).toFixed(2)} ₽
                  </span>
                  <span className={`hidden sm:inline-flex text-xs px-2 py-0.5 rounded-md border ${
                    pay.status === 1
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : pay.status === 0
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  }`}>
                    {pay.status === 1 ? 'Зачислен' : pay.status === 0 ? 'Ожидание' : 'Отменён'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
