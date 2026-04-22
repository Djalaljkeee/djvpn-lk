import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { fetchServices, buyService } from '../api/services'
import { fetchUserServices, changeService, fetchServiceOrders, fetchUserDevices, fetchRemnaInfo, deleteAllDevices } from '../api/user'
import { useToast } from '../components/Toast'
import SetupGuide from '../components/SetupGuide'
import type { Service, UserService, RemnaUserInfo, ServiceDevices, Device } from '../types'
import PlanCard from '../components/dashboard/PlanCard'
import TrafficSection from '../components/dashboard/TrafficSection'
import DeviceConnectionCard from '../components/dashboard/DeviceConnectionCard'
import CountdownBlock from '../components/dashboard/CountdownBlock'
import LocationsSection from '../components/dashboard/LocationsSection'
import CtaBanner from '../components/dashboard/CtaBanner'
import DeviceList from '../components/dashboard/DeviceList'

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
  onChanged,
  onNeedsTopup,
}: {
  svc: UserService
  catalog: Service[]
  onClose: () => void
  onChanged: (services: UserService[], confirmed: boolean) => void
  onNeedsTopup: (prompt: { amount: number; balance: number }) => void
}) {
  const { show } = useToast()
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
        const services = await fetchUserServices()
        onChanged(services, false)
        onNeedsTopup({ amount: res.amount_needed, balance: res.balance })
        onClose()
        return
      }
      const result = await waitForServiceChange(svc.id, svc.service_id)
      onChanged(result.services, result.confirmed)
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
  const [catalog, setCatalog] = useState<Service[]>([])
  const [myServices, setMyServices] = useState<UserService[]>([])
  const [availableIds, setAvailableIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<number | null>(null)
  const [justBought, setJustBought] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<'all' | 'available' | 'mine'>('all')
  const [changingId, setChangingId] = useState<number | null>(null)
  const [topupPrompt, setTopupPrompt] = useState<{ amount: number; balance: number } | null>(null)
  const [setupTarget, setSetupTarget] = useState<{ url?: string; serviceId?: number } | null>(null)
  const [remnaMap, setRemnaMap] = useState<Record<number, RemnaUserInfo>>({})
  const [devicesMap, setDevicesMap] = useState<Record<number, Device[]>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)

  const reload = useCallback(async () => {
    const [cat, svcs, orders, remnaList, devList] = await Promise.all([
      fetchServices(),
      fetchUserServices(),
      fetchServiceOrders(),
      fetchRemnaInfo().catch((): RemnaUserInfo[] => []),
      fetchUserDevices().catch((): ServiceDevices[] => []),
    ])
    setCatalog(cat)
    setMyServices(svcs)
    setAvailableIds(new Set(orders.map(o => o.service_id)))
    const rMap: Record<number, RemnaUserInfo> = {}
    for (const r of remnaList) rMap[r.user_service_id] = r
    setRemnaMap(rMap)
    const dMap: Record<number, Device[]> = {}
    for (const item of devList) dMap[item.user_service_id] = item.devices
    setDevicesMap(dMap)
  }, [])

  useEffect(() => {
    reload()
      .catch(() => show('Ошибка загрузки каталога', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const myActiveIds = new Set(myServices.filter(s => s.status === 1).map(s => s.service_id))
  const changingSvc = changingId !== null ? myServices.find(s => s.id === changingId) : null

  const sortedCatalog = useMemo(() => {
    const activeCatalog = catalog.filter(s => {
      if (s.status !== 1) return false
      if (myActiveIds.has(s.service_id)) return true
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
  }, [catalog, filter, myActiveIds, availableIds])

  const handleBuy = async (serviceId: number) => {
    setBuying(serviceId)
    try {
      const res = await buyService(serviceId)
      const updated = await fetchUserServices()
      setMyServices(updated)
      if (res?.needs_topup) {
        setTopupPrompt({ amount: res.amount_needed, balance: res.balance })
      } else {
        setJustBought(prev => new Set([...prev, serviceId]))
        show('Услуга успешно подключена', 'success')
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
    setRefreshing(true)
    try {
      const remnaList = await fetchRemnaInfo()
      const rMap: Record<number, RemnaUserInfo> = {}
      for (const r of remnaList) rMap[r.user_service_id] = r
      setRemnaMap(rMap)
    } catch {
      show('Не удалось обновить трафик', 'error')
    } finally {
      setRefreshing(false)
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

      {sortedCatalog.length === 0 ? (
        <div className="glass rounded-[2rem] p-10 text-center">
          <div className="text-5xl">🔎</div>
          <p className="mt-3 text-sm text-slate-300">По выбранному фильтру пока нет тарифов.</p>
        </div>
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
          onChanged={(services, _confirmed) => setMyServices(services)}
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
            limitIp={activeRemna?.hwid_device_limit ?? activeRemna?.limit_ip ?? null}
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
              totalLimit={activeRemna?.hwid_device_limit ?? activeRemna?.limit_ip ?? undefined}
              onDeleted={hwid =>
                setDevicesMap(prev => ({
                  ...prev,
                  [activeSvc.id]: (prev[activeSvc.id] ?? []).filter(d => d.hwid !== hwid),
                }))
              }
              onDeleteAll={async () => {
                await deleteAllDevices(activeSvc.id)
                setDevicesMap(prev => ({ ...prev, [activeSvc.id]: [] }))
              }}
            />
          </div>
        </section>
      )}

      {!activeSvc && catalogContent}
    </div>
  )
}
