import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { format, parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../Toast'
import {
  addonCancel, addonOrder, tariffUpgrade,
  type AddonCancelResult, type AddonQuote, type TariffInfo, type UpgradeQuote,
} from '../../api/tariffs'
import { formatPrice } from '../../utils/price'

export function formatDate(value?: string): string {
  if (!value) return ''
  try { return format(parseISO(value.replace(' ', 'T')), 'dd.MM.yyyy') } catch { return value }
}

export function pluralDevices(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'устройство'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'устройства'
  return 'устройств'
}

/** Сумма к пополнению: целые рубли вверх, платёжки копейки не любят. */
const topupAmount = (needPay: number) => Math.max(1, Math.ceil(needPay))

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-h-[90dvh] overflow-y-auto rounded-t-[2rem] border border-white/10 bg-[rgba(32,11,44,0.96)] p-5 shadow-2xl animate-slide-up sm:max-w-md sm:rounded-[2rem]">
        <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/15 sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors">
            Закрыть
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-slate-300">{label}</span>
      <span className={`font-mono ${accent ? 'font-semibold text-fuchsia-100' : 'text-white'}`}>{value}</span>
    </div>
  )
}

function PrimaryButton({ onClick, disabled, loading, children }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand disabled:opacity-50 hover:brightness-110 transition-all"
    >
      {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
      {children}
    </button>
  )
}

function useQuote<T>(load: () => Promise<T>) {
  const [quote, setQuote] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    load().then(q => { if (alive) setQuote(q) }).catch(e => { if (alive) setError(e?.message ?? 'Ошибка') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { quote, error }
}

const QuoteSkeleton = () => <div className="h-24 rounded-2xl bg-white/5 animate-pulse" />
const QuoteError = ({ text }: { text: string }) => (
  <div className="rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm text-rose-100">{text}</div>
)

export function AddonModal({ usi, onClose, onDone }: { usi: number; onClose: () => void; onDone: () => void }) {
  const { show } = useToast()
  const navigate = useNavigate()
  const { quote, error } = useQuote<AddonQuote>(() => addonOrder(usi))
  const [busy, setBusy] = useState(false)

  const buy = async () => {
    setBusy(true)
    try {
      await addonOrder(usi, true)
      show('Доп. устройство подключено', 'success')
      onDone()
      onClose()
    } catch (e: any) {
      show(e?.message ?? 'Не удалось подключить устройство', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Добавить устройство" onClose={onClose}>
      {error ? <QuoteError text={error} /> : !quote ? <QuoteSkeleton /> : (
        <>
          <p className="text-sm leading-6 text-slate-300">
            {quote.free
              ? 'Доп. устройство для вас бесплатно — по вашей скидке.'
              : <>Оплачивается остаток текущего периода, дальше доп. устройство продлевается вместе с тарифом
                {' '}за <span className="text-white">{formatPrice(quote.addon_monthly)} ₽/мес</span>.</>}
          </p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <Row label="Будет устройств" value={`${quote.devices + 1}`} />
            <Row label={`До ${formatDate(quote.expire)}`} value={`${formatPrice(quote.price)} ₽`} accent />
            <Row label="Баланс" value={`${formatPrice(quote.balance)} ₽`} />
            {quote.need_pay > 0 && <Row label="Не хватает" value={`${formatPrice(quote.need_pay)} ₽`} accent />}
          </div>
          {quote.need_pay > 0 ? (
            <PrimaryButton onClick={() => { onClose(); navigate(`/payments?amount=${topupAmount(quote.need_pay)}`) }}>
              Пополнить на {topupAmount(quote.need_pay)} ₽
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={buy} loading={busy}>
              {quote.price > 0 ? `Подключить за ${formatPrice(quote.price)} ₽` : 'Подключить'}
            </PrimaryButton>
          )}
        </>
      )}
    </Sheet>
  )
}

export function AddonCancelModal({ usi, onClose, onDone }: { usi: number; onClose: () => void; onDone: () => void }) {
  const { show } = useToast()
  const { quote, error } = useQuote<AddonCancelResult>(() => addonCancel(usi))
  const [busy, setBusy] = useState(false)

  const cancel = async () => {
    setBusy(true)
    try {
      const res = await addonCancel(usi, true)
      show(`Доп. устройство отключится ${formatDate(res.until)}`, 'success')
      onDone()
      onClose()
    } catch (e: any) {
      show(e?.message ?? 'Не удалось отключить устройство', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Отключить доп. устройство" onClose={onClose}>
      {error ? <QuoteError text={error} /> : !quote ? <QuoteSkeleton /> : (
        <>
          <p className="text-sm leading-6 text-slate-300">
            Доп. устройство работает до <span className="text-white">{formatDate(quote.until)}</span> и не будет
            продлено вместе с тарифом. Деньги за оплаченный период не возвращаются.
          </p>
          <button
            onClick={cancel}
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-rose-700 px-4 py-3.5 text-sm font-semibold text-white hover:brightness-110 transition-all disabled:opacity-50"
          >
            {busy && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            Отключить при продлении
          </button>
        </>
      )}
    </Sheet>
  )
}

/** Смена тарифа с пересчётом (на семейный, другой период, обратно на базовый):
 *  показывает доплату и либо меняет тариф сразу, либо отправляет на оплату —
 *  после неё SHM переключит сам. */
export function UpgradeModal({ usi, serviceId, onClose, onDone }: {
  usi: number; serviceId: number; onClose: () => void; onDone: () => void
}) {
  const { show } = useToast()
  const navigate = useNavigate()
  const { quote, error } = useQuote<UpgradeQuote>(() => tariffUpgrade(usi, serviceId))
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      const res = await tariffUpgrade(usi, serviceId, true)
      onDone()
      onClose()
      if (res.action === 'pay_required') {
        show('После оплаты тариф сменится автоматически', 'info')
        navigate(`/payments?amount=${topupAmount(res.need_pay)}`)
      } else {
        show(`Тариф изменён: «${res.new_service}»`, 'success')
      }
    } catch (e: any) {
      show(e?.message ?? 'Не удалось сменить тариф', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={quote?.new_tier === 'family' ? 'Переход на Семейный' : 'Смена тарифа'} onClose={onClose}>
      {error ? <QuoteError text={error} /> : !quote ? <QuoteSkeleton /> : (
        <>
          <p className="text-sm leading-6 text-slate-300">
            <span className="text-white">{quote.new_service}</span> — до {quote.devices} {pluralDevices(quote.devices)}.
            {' '}Новый период начнётся сразу, неиспользованный остаток текущего тарифа
            {quote.addons > 0 ? ' и доп. устройств' : ''} вернётся на баланс.
          </p>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <Row label="Тариф" value={`${formatPrice(quote.tariff_price)} ₽`} />
            {quote.keep_addons > 0 && (
              <Row label={`Доп. устройства × ${quote.keep_addons}`} value={`${formatPrice(quote.addons_price)} ₽`} />
            )}
            {quote.refund > 0 && <Row label="Возврат за остаток" value={`−${formatPrice(quote.refund)} ₽`} />}
            <Row label="Баланс" value={`${formatPrice(quote.balance)} ₽`} />
            <Row label="К оплате" value={quote.need_pay > 0 ? `${formatPrice(quote.need_pay)} ₽` : '0 ₽'} accent />
          </div>
          {quote.addons > 0 && quote.new_tier === 'family' && (
            <p className="mt-3 text-xs leading-5 text-slate-400">
              Доп. устройства отключатся: в семейном тарифе уже {quote.devices} {pluralDevices(quote.devices)}.
            </p>
          )}
          <PrimaryButton onClick={confirm} loading={busy}>
            {quote.need_pay > 0 ? `Оплатить ${formatPrice(quote.need_pay)} ₽ и перейти` : 'Перейти сейчас'}
          </PrimaryButton>
        </>
      )}
    </Sheet>
  )
}

interface Props {
  info: TariffInfo
  connected: number
  onChanged: () => void
}

export default function DevicePlanCard({ info, connected, onChanged }: Props) {
  const navigate = useNavigate()
  const [modal, setModal] = useState<'add' | 'cancel' | 'upgrade' | null>(null)
  const active = info.status === 'ACTIVE'
  const activeAddons = info.addon_list.filter(a => !a.cancelled)
  const overLimit = info.base_devices > 0 && connected > info.devices
  const canUpgrade = active && info.tier === 'base' && info.family_service_id > 0

  if (!(info.base_devices > 0)) return null

  return (
    <div className="glass rounded-[1.75rem] p-5">
      {modal === 'add' && <AddonModal usi={info.usi} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'cancel' && <AddonCancelModal usi={info.usi} onClose={() => setModal(null)} onDone={onChanged} />}
      {modal === 'upgrade' && (
        <UpgradeModal usi={info.usi} serviceId={info.family_service_id} onClose={() => setModal(null)} onDone={onChanged} />
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">Устройства по тарифу</div>
          <div className="mt-1 text-xs text-slate-400">
            {info.base_devices} в тарифе{info.addons > 0 ? ` + ${info.addons} доп.` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold leading-none ${overLimit ? 'text-rose-400' : 'text-white'}`}>
            {connected}<span className="text-sm font-medium text-slate-400"> / {info.devices}</span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">подключено</div>
        </div>
      </div>

      {overLimit && (
        <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-xs leading-5 text-amber-100">
          Подключено больше устройств, чем входит в тариф. Добавьте устройства
          {canUpgrade ? ' или перейдите на Семейный' : ''}, либо удалите лишние в списке ниже.
        </div>
      )}

      {info.pending_upgrade > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-brand-300/25 bg-brand-500/10 px-4 py-3 text-xs text-fuchsia-100">
          <span>Переход на Семейный ждёт оплаты — после пополнения тариф сменится сам.</span>
          <button onClick={() => navigate('/payments')} className="shrink-0 font-semibold text-white underline">Оплатить</button>
        </div>
      )}

      {info.addon_list.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {info.addon_list.map((a, i) => (
            <div key={a.usi} className="flex items-center justify-between rounded-xl bg-white/4 px-3 py-2 text-xs">
              <span className="text-slate-200">Доп. устройство {i + 1}</span>
              <span className={a.cancelled ? 'text-amber-200' : 'text-slate-400'}>
                {a.cancelled ? `отключится ${formatDate(a.expire)}` : `до ${formatDate(a.expire)}${a.cost > 0 ? '' : ' · бесплатно'}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {info.addons_available === 1 && (
            <button
              onClick={() => setModal('add')}
              className="rounded-2xl bg-brand-500/18 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              + Устройство{info.addon_monthly ? ` · ${formatPrice(info.addon_monthly)} ₽/мес` : ''}
            </button>
          )}
          {canUpgrade && (
            <button
              onClick={() => setModal('upgrade')}
              className="rounded-2xl border border-emerald-300/20 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 transition-all"
            >
              Семейный — 10 устройств
            </button>
          )}
          {activeAddons.length > 0 && (
            <button
              onClick={() => setModal('cancel')}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors sm:col-span-2"
            >
              Отключить доп. устройство
            </button>
          )}
        </div>
      )}
    </div>
  )
}
