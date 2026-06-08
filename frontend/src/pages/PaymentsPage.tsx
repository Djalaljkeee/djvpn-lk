import { useRef, useState } from 'react'
import { applyPromoCode } from '../api/user'
import { buildPaymentUrl } from '../api/services'
import { useToast } from '../components/Toast'
import { useDashboard, useDashboardSlice, useInvalidateDashboard } from '../hooks/useDashboard'
import type { PromoApplyResult } from '../types'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ru } from 'date-fns/locale'

const HISTORY_PAGE_SIZE = 25

// Русская плюрализация счётчика: 1 транзакция, 2 транзакции, 5 транзакций.
function pluralTransactions(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'транзакция'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'транзакции'
  return 'транзакций'
}

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
  const [historyPage, setHistoryPage] = useState(0)
  const [amount, setAmount] = useState('')
  const suggestedAmounts = [199, 499, 899, 1599]
  const loading = dashLoading && !data
  const topUpRef = useRef<HTMLElement>(null)

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

  // Все позиции прогноза с предстоящим списанием (next-период). Делим их на:
  //  • продления активных подписок (status ACTIVE) — это «Предстоящие расходы»;
  //  • неоплаченные услуги — заказы в корзине, которые ещё не перешли в оплату.
  const upcomingItems = forecastItems.filter(item => item.next)
  const renewalItems = upcomingItems.filter(item => item.status === 'ACTIVE')
  const unpaidItems = upcomingItems.filter(item => item.status !== 'ACTIVE')

  // Прогноз продления активных подписок: номинал (без скидки) и сумма к списанию.
  const renewalNominal = renewalItems.reduce((sum, item) => sum + (item.next!.cost ?? 0), 0)
  const renewalCharged = renewalItems.reduce((sum, item) => sum + (item.next!.total ?? 0), 0)
  const renewalNeedsTopUp = renewalCharged > 0 && balance < renewalCharged

  // Неоплаченные услуги: сумма к оплате и сколько ещё нужно доплатить.
  const unpaidCharged = unpaidItems.reduce((sum, item) => sum + (item.next!.total ?? 0), 0)
  const unpaidShortfall = Math.max(0, unpaidCharged - balance)

  const nearestItem = renewalItems
    .filter(item => item.expire)
    .sort((a, b) =>
      new Date(a.expire!.replace(' ', 'T')).getTime() - new Date(b.expire!.replace(' ', 'T')).getTime()
    )[0] ?? null

  const daysUntilPayment = nearestItem?.expire
    ? differenceInDays(parseISO(nearestItem.expire.replace(' ', 'T')), new Date())
    : null

  // Кнопка «Пополнить» из карточки неоплаченных услуг: подставляем недостающую
  // сумму в поле пополнения и прокручиваем к секции пополнения.
  const handleTopUpForUnpaid = () => {
    if (unpaidShortfall > 0) setAmount(String(Math.ceil(unpaidShortfall)))
    topUpRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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

  // История операций: прячем «мусорные» нулевые операции (отменённые пополнения
  // ЮKassa приходят суммой 0.00 ₽), остальное листаем по HISTORY_PAGE_SIZE.
  const visiblePayments = payments.filter(p => Math.abs(p.amount ?? 0) >= 0.005)
  const historyTotal = visiblePayments.length
  const historyPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  const historyPageSafe = Math.min(historyPage, historyPages - 1)
  const historyStart = historyPageSafe * HISTORY_PAGE_SIZE
  const historyItems = visiblePayments.slice(historyStart, historyStart + HISTORY_PAGE_SIZE)

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

      {/* Unpaid services (cart) — заказы, добавленные в корзину, но не оплаченные */}
      {unpaidItems.length > 0 && (
        <section className="rounded-[2rem] border border-amber-300/25 bg-amber-500/10 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-200">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-amber-200/80">Требует оплаты</div>
                <h2 className="text-lg font-semibold text-white">Неоплаченные услуги</h2>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-2xl font-bold text-white">{unpaidCharged.toFixed(0)} ₽</div>
              <div className="text-xs text-amber-200/80">к оплате</div>
            </div>
          </div>

          <p className="mt-2 text-sm text-amber-100/90">
            Добавлены в корзину, но ещё не оплачены. Пополните баланс, чтобы активировать.
          </p>

          <div className="mt-3 space-y-2">
            {unpaidItems.map((item, idx) => (
              <div key={item.user_service_id || item.usi || idx} className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{item.name}</div>
                    <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-200/90">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                      Ожидает оплаты
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-white">{item.next!.total.toFixed(2)} ₽</div>
                </div>
              </div>
            ))}
          </div>

          {unpaidShortfall > 0 ? (
            <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-amber-100">
                Недостаточно средств. Пополните баланс на{' '}
                <span className="font-semibold">{Math.ceil(unpaidShortfall)} ₽</span>
              </div>
              <button
                onClick={handleTopUpForUnpaid}
                className="shrink-0 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-brand hover:brightness-110 transition-all"
              >
                Пополнить
              </button>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              Баланса достаточно — услуга активируется при ближайшем списании.
            </div>
          )}
        </section>
      )}

      {/* Renewal forecast — продления активных подписок */}
      {renewalItems.length > 0 && (
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
            <div className="shrink-0 text-2xl font-bold text-white">{renewalNominal.toFixed(0)} ₽</div>
          </div>

          <div className="mt-3 space-y-2">
            {renewalItems.map((item, idx) => (
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
            <span>Будет списано при продлении: <span className="font-semibold">{renewalCharged.toFixed(2)} ₽</span></span>
          </div>

          {renewalNeedsTopUp && (
            <div className="mt-3 rounded-2xl border border-fuchsia-300/20 bg-fuchsia-500/10 px-4 py-3 text-sm text-fuchsia-100">
              Недостаточно средств. Пополните баланс на{' '}
              <span className="font-semibold">{(renewalCharged - balance).toFixed(0)} ₽</span>
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
      <section ref={topUpRef} className="glass rounded-[2rem] p-5">
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
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-white">История операций</h2>
            <p className="mt-0.5 text-sm text-slate-400">{historyTotal} {pluralTransactions(historyTotal)}</p>
          </div>
          <svg
            className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-200 ${historyOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {historyOpen && (
          historyTotal > 0 ? (
            <div className="border-t border-white/10">
              {historyItems.map((pay, idx) => {
                const amount = pay.amount ?? 0
                const incoming = amount >= 0
                const name = pay.pay_system_name && typeof pay.pay_system_name === 'string' && isNaN(Number(pay.pay_system_name))
                  ? pay.pay_system_name
                  : incoming ? 'Пополнение' : 'Списание'
                return (
                  <div key={pay.id ?? idx} className="flex items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${incoming ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={incoming ? 'M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25' : 'M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25'} />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{name}</div>
                      <div className="mt-0.5 text-xs text-slate-400">
                        {pay.created ? format(parseISO(pay.created.replace(' ', 'T')), 'd MMM yyyy, HH:mm', { locale: ru }) : '—'}
                        {pay.comment && ` · ${pay.comment}`}
                      </div>
                    </div>
                    <div className={`shrink-0 text-sm font-semibold ${incoming ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {incoming ? '+' : ''}{amount.toFixed(2)} ₽
                    </div>
                  </div>
                )
              })}

              {historyPages > 1 && (
                <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-slate-400">
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">{HISTORY_PAGE_SIZE}/стр</span>
                  <div className="flex items-center gap-3">
                    <span>{historyStart + 1}–{historyStart + historyItems.length} / {historyTotal}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setHistoryPage(p => Math.max(0, p - 1))}
                        disabled={historyPageSafe <= 0}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
                        aria-label="Предыдущая страница"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setHistoryPage(p => Math.min(historyPages - 1, p + 1))}
                        disabled={historyPageSafe >= historyPages - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
                        aria-label="Следующая страница"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
