import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { buyService } from '../api/services'
import { fetchUserServices, changeService, deleteAllDevices, deleteService } from '../api/user'
import { saveCart, clearCart } from '../api/cart'
import { useToast } from '../components/Toast'
import { useDashboard, useDashboardSlice, useInvalidateDashboard, useCatalog } from '../hooks/useDashboard'
import SetupGuide from '../components/SetupGuide'
import type { Service, UserService } from '../types'
import PlanCard from '../components/dashboard/PlanCard'
import TrafficSection from '../components/dashboard/TrafficSection'
import DeviceConnectionCard from '../components/dashboard/DeviceConnectionCard'
import CountdownBlock from '../components/dashboard/CountdownBlock'
import LocationsSection from '../components/dashboard/LocationsSection'
import CtaBanner from '../components/dashboard/CtaBanner'
import DeviceList from '../components/dashboard/DeviceList'
import { resolveDeviceLimit } from '../utils/deviceLimit'

function periodLabel(period: number, type: string) {
  if (type === 'month') return period === 1 ? 'в месяц' : `за ${period} мес`
  if (type === 'year') return period === 1 ? 'в год' : `за ${period} г`
  return period === 1 ? 'в день' : `за ${period} дн`
}

async function waitForServiceChange(userServiceId: number, previousServiceId: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 12000) {
    const services = await fetchUserServices()
    const current = services.find(item => item.id === userServiceId)
    if (current && current.service_id !== previousServiceId) {
      return { services, confirmed: true }
    }
    await new Promise(resolve => setTimeout(resolve, 1200))
  }
  const services = await fetchUserServices()
  return { services, confirmed: false }
}

function ChangeTariffModal({
  svc,
  catalog,
  onClose,
  onNeedsTopup,
}: {
  svc: UserService
  catalog: Service[]
  onClose: () => void
  onNeedsTopup: (prompt: { amount: number; balance: number }) => void
}) {
  const { show } = useToast()
  const invalidate = useInvalidateDashboard()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const available = catalog
    .filter(s => s.status === 1 && s.service_id !== svc.service_id)
    .sort((a, b) => a.cost - b.cost)

  const handleChange = async () => {
    if (!selectedId || !svc.id) return
    setLoading(true)
    try {
      const res = await changeService(svc.id, selectedId)
      if (res?.needs_topup) {
        await invalidate()
        onNeedsTopup({ amount: res.amount_needed, balance: res.balance })
        onClose()
        return
      }
      const result = await waitForServiceChange(svc.id, svc.service_id)
      await invalidate()
      show(
        result.confirmed
          ? 'Тариф обновлён и уже отражён в списке услуг'
          : 'Запрос принят. Биллинг обновляет тариф, список уже перезагружен.',
        'success',
      )
      onClose()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка смены тарифа', 'error')
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-h-[90dvh] flex-col rounded-t-[2rem] border border-white/10 bg-[rgba(32,11,44,0.96)] p-5 shadow-2xl backdrop-blur-2xl animate-slide-up sm:max-w-lg sm:rounded-[2rem]">
        <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/15 sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Сменить тариф</h2>
            <p className="mt-1 text-sm text-slate-300">
              Текущий тариф: <span className="text-white">{svc.name}</span>
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 transition-colors">
            Закрыть
          </button>
        </div>

        <div className="mt-5 flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
          {available.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              Сейчас нет доступных вариантов для смены тарифа.
            </div>
          ) : (
            available.map(option => (
              <button
                key={option.service_id}
                onClick={() => setSelectedId(option.service_id)}
                className={`w-full rounded-2xl border p-4 text-left transition-all ${
                  selectedId === option.service_id
                    ? 'border-brand-300/60 bg-brand-500/20'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-white">{option.name}</div>
                    {option.descr && <div className="mt-1 text-sm leading-6 text-slate-300">{option.descr}</div>}
                  </div>
                  <div className="rounded-xl bg-white/5 px-3 py-2 text-right">
                    <div className="text-lg font-bold text-white">{option.cost} ₽</div>
                    <div className="text-xs text-slate-300">{periodLabel(option.period, option.period_type)}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <button
          onClick={handleChange}
          disabled={!selectedId || loading}
          className="mt-5 flex w-full shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand disabled:opacity-50 hover:brightness-110 transition-all"
        >
          {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          {loading ? 'Меняем тариф и ждём ответ биллинга' : 'Подтвердить смену тарифа'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

export default function ServicesPage() {
  const { show } = useToast()
  const navigate = useNavigate()
  const { data, loading: dashLoading, refreshing } = useDashboard()
  const { catalog, loading: catalogLoading } = useCatalog()
  const invalidate = useInvalidateDashboard()
  const myServices = useDashboardSlice(d => d?.services ?? [])
  const orders = useDashboardSlice(d => d?.orders ?? [])
  const remnaList = useDashboardSlice(d => d?.remna_info ?? [])
  const devicesList = useDashboardSlice(d => d?.devices ?? [])
  const [buying, setBuying] = useState<number | null>(null)
  const [justBought, setJustBought] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<'all' | 'available' | 'mine'>('all')
  const [changingId, setChangingId] = useState<number | null>(null)
  const [topupPrompt, setTopupPrompt] = useState<{ amount: number; balance: number } | null>(null)
  const [setupTarget, setSetupTarget] = useState<{ url?: string; serviceId?: number } | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<UserService | null>(null)
  const [deleting, setDeleting] = useState(false)

  const availableIds = useMemo(() => new Set(orders.map(o => o.service_id)), [orders])
  const remnaMap = useMemo(
    () => Object.fromEntries(remnaList.map(r => [r.user_service_id, r])),
    [remnaList],
  )
  const devicesMap = useMemo(
    () => Object.fromEntries(devicesList.map(d => [d.user_service_id, d.devices])),
    [devicesList],
  )

  const myActiveIds = useMemo(
    () => new Set(myServices.filter(s => s.status === 1).map(s => s.service_id)),
    [myServices],
  )
  // Неоплаченные услуги — заказы в корзине, не перешедшие в оплату: статус
  // не ACTIVE (1) и не REMOVED (3), т.е. INIT/PROGRESS (0) или NOT PAID (2).
  const unpaidServices = useMemo(
    () => myServices.filter(s => s.status === 0 || s.status === 2),
    [myServices],
  )
  const unpaidServiceIds = useMemo(
    () => new Set(unpaidServices.map(s => s.service_id)),
    [unpaidServices],
  )
  const changingSvc = changingId !== null ? myServices.find(s => s.id === changingId) : null
  const loading = (dashLoading || catalogLoading) && !data

  const sortedCatalog = useMemo(() => {
    const activeCatalog = catalog.filter(s => {
      if (s.status !== 1) return false
      if (myActiveIds.has(s.service_id)) return true
      // Тариф с неоплаченным заказом не дублируем в каталоге — он показан
      // в блоке «Неоплаченные услуги».
      if (unpaidServiceIds.has(s.service_id)) return false
      return availableIds.has(s.service_id)
    })
    const filtered = activeCatalog.filter(s => {
      if (filter === 'mine') return myActiveIds.has(s.service_id)
      if (filter === 'available') return !myActiveIds.has(s.service_id)
      return true
    })

    return [...filtered].sort((a, b) => {
      const aOwned = myActiveIds.has(a.service_id)
      const bOwned = myActiveIds.has(b.service_id)
      if (aOwned !== bOwned) return aOwned ? -1 : 1
      return a.cost - b.cost
    })
  }, [catalog, filter, myActiveIds, availableIds, unpaidServiceIds])

  const handleBuy = async (serviceId: number) => {
    setBuying(serviceId)
    try {
      const res = await buyService(serviceId)
      await invalidate()
      if (res?.needs_topup) {
        setTopupPrompt({ amount: res.amount_needed ?? 0, balance: res.balance ?? 0 })
        // Сохраняем корзину, чтобы при возврате на дашборд был баннер «завершить покупку».
        const catalogItem = catalog.find(s => s.service_id === serviceId)
        saveCart({
          service_id: serviceId,
          service_name: catalogItem?.name,
          cost: catalogItem?.cost,
          amount_needed: res.amount_needed,
          balance: res.balance,
        }).catch(() => { /* backend без БД — игнорируем */ })
      } else {
        setJustBought(prev => new Set([...prev, serviceId]))
        show('Услуга успешно подключена', 'success')
        clearCart().catch(() => { /* ignore */ })
        setTimeout(() => {
          setJustBought(prev => {
            const next = new Set(prev)
            next.delete(serviceId)
            return next
          })
        }, 3000)
      }
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка при покупке услуги', 'error')
    } finally {
      setBuying(null)
    }
  }

  const handleRefreshTraffic = async () => {
    try {
      await invalidate()
    } catch {
      show('Не удалось обновить трафик', 'error')
    }
  }

  const handleDelete = async (svc: UserService) => {
    setDeleting(true)
    try {
      await deleteService(svc.id)
      await invalidate()
      show('Услуга удалена', 'success')
      setConfirmDelete(null)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Не удалось удалить услугу', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const activeSvc = myServices.find(s => s.status === 1) ?? null
  const activeRemna = activeSvc ? (remnaMap[activeSvc.id] ?? null) : null
  const activeDevices = activeSvc ? (devicesMap[activeSvc.id] ?? []) : []
  const expiredAt = activeSvc?.expired ? parseISO(activeSvc.expired.replace(' ', 'T')) : null

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="h-64 rounded-[2rem] bg-white/5 animate-pulse" />
        <div className="h-10 w-72 rounded-2xl bg-white/5 animate-pulse" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(item => <div key={item} className="h-72 rounded-[1.75rem] bg-white/5 animate-pulse" />)}
        </div>
      </div>
    )
  }

  const catalogContent = (
    <div className="space-y-4 animate-fade-in">
      <section className="flex w-full gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-sm">
        {([
          { key: 'all', label: 'Все' },
          { key: 'available', label: 'Доступные' },
          { key: 'mine', label: 'Мои' },
        ] as const).map(item => (
          <button
            key={item.key}
            onClick={() => setFilter(item.key)}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
              filter === item.key
                ? 'bg-gradient-to-r from-brand-600/30 to-brand-700/20 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            {item.label}
          </button>
        ))}
      </section>

      {(filter === 'all' || filter === 'mine') && unpaidServices.length > 0 && (
        <section className="rounded-[2rem] border border-amber-300/25 bg-amber-500/10 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-200">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-amber-200/80">Ожидают оплаты</div>
              <h3 className="text-base font-semibold text-white">Неоплаченные услуги</h3>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {unpaidServices.map(svc => (
              <div key={svc.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{svc.name}</div>
                  <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-200/90">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                    Ожидает оплаты
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {svc.cost != null && <span className="text-sm font-semibold text-white">{svc.cost} ₽</span>}
                  <button
                    onClick={() => navigate('/payments')}
                    className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 px-3 py-1.5 text-xs font-semibold text-white shadow-brand hover:brightness-110 transition-all"
                  >
                    Оплатить
                  </button>
                  <button
                    onClick={() => setConfirmDelete(svc)}
                    aria-label="Удалить услугу"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-rose-300/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sortedCatalog.length === 0 ? (
        (filter === 'all' || filter === 'mine') && unpaidServices.length > 0 ? null : (
          <div className="glass rounded-[2rem] p-10 text-center">
            <div className="text-5xl">🔎</div>
            <p className="mt-3 text-sm text-slate-300">По выбранному фильтру пока нет тарифов.</p>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedCatalog.map(svc => {
            const owned = myActiveIds.has(svc.service_id)
            const isBuying = buying === svc.service_id
            const success = justBought.has(svc.service_id)
            const disabled = owned || isBuying

            return (
              <div
                key={svc.service_id}
                className={`glass glass-hover relative flex h-full flex-col rounded-[1.75rem] p-5 transition-all ${
                  owned ? 'ring-1 ring-emerald-400/30' : ''
                }`}
              >
                {owned && (
                  <div className="absolute left-0 top-6 bottom-6 w-1 rounded-full bg-emerald-400/60" />
                )}

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold text-white">{svc.name}</div>
                    {svc.category && (
                      <div className="mt-1 text-xs uppercase tracking-[0.2em] text-fuchsia-100/70">{svc.category}</div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                    owned
                      ? 'bg-emerald-500/15 text-emerald-100'
                      : 'bg-brand-500/15 text-fuchsia-100'
                  }`}>
                    {owned ? 'Активна' : 'Доступна'}
                  </span>
                </div>

                {svc.descr && <p className="mt-4 text-sm leading-6 text-slate-200">{svc.descr}</p>}

                <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Стоимость</div>
                      <div className="mt-1 text-4xl font-black gradient-text leading-none">{svc.cost} ₽</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Период</div>
                      <div className="mt-1 font-mono text-sm text-white">{periodLabel(svc.period, svc.period_type)}</div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => !disabled && handleBuy(svc.service_id)}
                  disabled={disabled}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all ${
                    success
                      ? 'bg-emerald-500/20 text-emerald-100'
                      : owned
                        ? 'bg-white/5 text-slate-400'
                        : 'bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-brand hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  {isBuying && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  {success ? 'Подключено' : owned ? 'Уже подключена' : isBuying ? 'Покупаем…' : 'Подключить тариф'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-6 animate-fade-in">
      {changingSvc && (
        <ChangeTariffModal
          svc={changingSvc}
          catalog={catalog}
          onClose={() => setChangingId(null)}
          onNeedsTopup={prompt => setTopupPrompt(prompt)}
        />
      )}

      {setupTarget && (
        <SetupGuide
          subUrl={setupTarget.url}
          serviceId={setupTarget.serviceId}
          onClose={() => setSetupTarget(null)}
        />
      )}

      {topupPrompt && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setTopupPrompt(null)} />
          <div className="relative w-full max-h-[90dvh] overflow-y-auto rounded-t-[2rem] bg-[rgba(32,11,44,0.96)] p-5 animate-slide-up sm:max-w-md sm:rounded-[2rem]">
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/15 sm:hidden" />
            <div className="text-4xl">💳</div>
            <h2 className="mt-3 text-xl font-bold text-white">Недостаточно средств</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Услуга уже зарегистрирована. Для активации нужно пополнить баланс.
            </p>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
              <div className="flex justify-between text-slate-300">
                <span>Текущий баланс</span>
                <span className="font-mono text-white">{topupPrompt.balance.toFixed(2)} ₽</span>
              </div>
              <div className="mt-2 flex justify-between text-slate-300">
                <span>Нужно пополнить</span>
                <span className="font-mono text-fuchsia-100">{topupPrompt.amount.toFixed(2)} ₽</span>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button onClick={() => setTopupPrompt(null)} className="w-full rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-300 hover:bg-white/8 transition-colors">
                Позже
              </button>
              <button
                onClick={() => { setTopupPrompt(null); navigate('/payments') }}
                className="w-full rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-brand hover:brightness-110 transition-all"
              >
                Перейти к оплате
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmDelete && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !deleting && setConfirmDelete(null)} />
          <div className="relative w-full max-h-[90dvh] overflow-y-auto rounded-t-[2rem] bg-[rgba(32,11,44,0.96)] p-5 animate-slide-up sm:max-w-md sm:rounded-[2rem]">
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/15 sm:hidden" />
            <div className="text-4xl">🗑️</div>
            <h2 className="mt-3 text-xl font-bold text-white">Удалить услугу?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Услуга <span className="text-white">«{confirmDelete.name}»</span> будет удалена без возможности восстановления.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
                className="w-full rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-300 hover:bg-white/8 transition-colors disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-rose-700 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 transition-all disabled:opacity-50"
              >
                {deleting && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                {deleting ? 'Удаляем…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Active Subscription Detail ── */}
      {activeSvc && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Подписка</h2>

          <PlanCard svc={activeSvc} remnaInfo={activeRemna} />

          {/* Management controls */}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => setSetupTarget(
                activeSvc.subscription_url ? { url: activeSvc.subscription_url } : { serviceId: activeSvc.id ?? undefined }
              )}
              className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
              </svg>
              Настроить подключение
            </button>
            <button
              onClick={() => setChangingId(activeSvc.id ?? null)}
              className="flex items-center justify-center gap-2 rounded-2xl bg-brand-500/18 px-4 py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
              </svg>
              Сменить тариф
            </button>
          </div>

          <TrafficSection
            usedBytes={activeRemna?.used_traffic_bytes ?? null}
            limitBytes={activeRemna?.traffic_limit_bytes ?? null}
            onRefresh={handleRefreshTraffic}
            refreshing={refreshing}
          />

          <DeviceConnectionCard
            connectedCount={activeDevices.length}
            limitIp={resolveDeviceLimit(activeRemna)}
          />

          <CountdownBlock expiredAt={expiredAt} />

          {(activeRemna?.locations ?? []).length > 0 && (
            <LocationsSection locations={activeRemna!.locations} />
          )}

          <CtaBanner onClick={() => setCatalogOpen(open => !open)} open={catalogOpen} />

          {catalogOpen && catalogContent}

          <div className="glass rounded-[1.75rem] p-5">
            <DeviceList
              devices={activeDevices}
              user_service_id={activeSvc.id}
              totalLimit={resolveDeviceLimit(activeRemna)}
              onDeleted={() => { void invalidate() }}
              onDeleteAll={async () => {
                await deleteAllDevices(activeSvc.id)
                await invalidate()
              }}
            />
          </div>
        </section>
      )}

      {!activeSvc && catalogContent}
    </div>
  )
}
