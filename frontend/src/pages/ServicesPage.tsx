import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchServices, buyService } from '../api/services'
import { fetchUserServices, changeService, stopService, deleteService, fetchServiceOrders } from '../api/user'
import { useToast } from '../components/Toast'
import SetupGuide from '../components/SetupGuide'
import ParticleCanvas from '../components/ParticleCanvas'
import type { Service, UserService } from '../types'

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
}: {
  svc: UserService
  catalog: Service[]
  onClose: () => void
  onChanged: (services: UserService[], confirmed: boolean) => void
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
      await changeService(svc.id, selectedId)
      const result = await waitForServiceChange(svc.id, svc.service_id)
      onChanged(result.services, result.confirmed)
      if (result.confirmed) {
        show('Тариф обновлен и уже отражен в списке услуг', 'success')
        onClose()
      } else {
        show('Запрос принят. Биллинг обновляет тариф, список уже перезагружен.', 'success')
        onClose()
      }
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка смены тарифа', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full rounded-t-[2rem] border border-white/10 bg-[rgba(32,11,44,0.96)] p-5 shadow-2xl backdrop-blur-2xl animate-slide-up sm:max-w-lg sm:rounded-[2rem]">
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

        <div className="mt-5 space-y-3">
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
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand disabled:opacity-50 hover:brightness-110 transition-all"
        >
          {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          {loading ? 'Меняем тариф и ждём ответ биллинга' : 'Подтвердить смену тарифа'}
        </button>
      </div>
    </div>
  )
}

export default function ServicesPage() {
  const { show } = useToast()
  const navigate = useNavigate()
  const [catalog, setCatalog] = useState<Service[]>([])
  const [myServices, setMyServices] = useState<UserService[]>([])
  const [orderedIds, setOrderedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState<number | null>(null)
  const [justBought, setJustBought] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<'all' | 'available' | 'mine'>('all')
  const [changingId, setChangingId] = useState<number | null>(null)
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [topupPrompt, setTopupPrompt] = useState<{ amount: number; balance: number } | null>(null)
  const [setupTarget, setSetupTarget] = useState<{ url?: string; serviceId?: number } | null>(null)

  const reload = async () => {
    const [cat, svcs, orders] = await Promise.all([fetchServices(), fetchUserServices(), fetchServiceOrders()])
    setCatalog(cat)
    setMyServices(svcs)
    setOrderedIds(new Set(orders.map(o => o.service_id)))
  }

  useEffect(() => {
    reload()
      .catch(() => show('Ошибка загрузки каталога', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const myActiveIds = new Set(myServices.filter(s => s.status === 1).map(s => s.service_id))
  const changingSvc = changingId !== null ? myServices.find(s => s.id === changingId) : null

  const sortedCatalog = useMemo(() => {
    const activeCatalog = catalog.filter(s => s.status === 1)
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
  }, [catalog, filter, myActiveIds])

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

  const handleStop = async (svc: UserService) => {
    if (!svc.id) return
    if (!confirm(`Остановить услугу «${svc.name}»?`)) return
    setActionLoading(svc.id)
    try {
      await stopService(svc.id)
      await reload()
      show('Услуга остановлена', 'success')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка остановки', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (svc: UserService) => {
    if (!svc.id) return
    if (!confirm(`Удалить услугу «${svc.name}»? Это действие необратимо.`)) return
    setActionLoading(svc.id)
    try {
      await deleteService(svc.id)
      await reload()
      show('Услуга удалена', 'success')
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка удаления', 'error')
    } finally {
      setActionLoading(null)
    }
  }

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

  return (
    <div className="space-y-6 animate-fade-in">
      {changingSvc && (
        <ChangeTariffModal
          svc={changingSvc}
          catalog={catalog}
          onClose={() => setChangingId(null)}
          onChanged={(services, _confirmed) => setMyServices(services)}
        />
      )}

      {setupTarget && (
        <SetupGuide
          subUrl={setupTarget.url}
          serviceId={setupTarget.serviceId}
          onClose={() => setSetupTarget(null)}
        />
      )}

      {topupPrompt && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setTopupPrompt(null)} />
          <div className="relative w-full rounded-t-[2rem] bg-[rgba(32,11,44,0.96)] p-5 animate-slide-up sm:max-w-md sm:rounded-[2rem]">
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
        </div>
      )}

      {/* ── Hero Section ── */}
      <section className="relative overflow-hidden rounded-[2rem] min-h-[260px] sm:min-h-[300px]">
        {/* Particle animation background */}
        <ParticleCanvas />

        {/* Dark gradient overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(145deg, rgba(240,120,228,0.18) 0%, rgba(120,47,168,0.16) 40%, rgba(20,7,31,0.88) 100%)',
          }}
        />
        {/* Subtle dot grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,220,250,0.7) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />
        {/* Border */}
        <div className="absolute inset-0 rounded-[2rem] border border-white/10 pointer-events-none" />

        {/* Content */}
        <div className="relative z-10 flex flex-col gap-6 p-5 sm:p-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            {/* Eyebrow */}
            <div className="flex items-center gap-2">
              <ShieldIcon className="h-4 w-4 text-brand-300 animate-float" />
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-200/80">Тарифы DJ VPN</span>
            </div>
            <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl leading-tight">
              Выберите&nbsp;
              <span className="gradient-text">свой тариф</span>
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">
              Активные услуги подняты наверх. Остальные отсортированы по стоимости.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 sm:min-w-[300px]">
            <HeroStatCard
              label="Активных"
              value={String(myActiveIds.size)}
              active={myActiveIds.size > 0}
            />
            <HeroStatCard
              label="Тарифов"
              value={String(catalog.filter(s => s.status === 1).length)}
            />
            <HeroStatCard
              label="Заказано"
              value={String(orderedIds.size)}
            />
          </div>
        </div>
      </section>

      {/* ── Filter Bar ── */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Каталог тарифов</h2>
          <p className="mt-1 text-sm text-slate-400">Сначала подключенные услуги, затем остальные по возрастанию цены.</p>
        </div>

        <div className="flex w-full gap-1.5 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-sm sm:w-auto">
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
        </div>
      </section>

      {/* ── Service Cards ── */}
      {sortedCatalog.length === 0 ? (
        <div className="glass rounded-[2rem] p-10 text-center">
          <div className="text-5xl">🔎</div>
          <p className="mt-3 text-sm text-slate-300">По выбранному фильтру пока нет тарифов.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedCatalog.map(svc => {
            const owned = myActiveIds.has(svc.service_id)
            const used = !owned && orderedIds.has(svc.service_id)
            const isBuying = buying === svc.service_id
            const success = justBought.has(svc.service_id)
            const disabled = owned || used || isBuying

            return (
              <div
                key={svc.service_id}
                className={`glass glass-hover relative flex h-full flex-col rounded-[1.75rem] p-5 transition-all ${
                  owned ? 'ring-1 ring-emerald-400/30' : used ? 'opacity-80' : ''
                }`}
              >
                {/* Left accent bar for owned */}
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusPill owned={owned} used={used} />
                    <ShieldIcon className={`h-7 w-7 flex-shrink-0 ${owned ? 'text-emerald-300/70' : 'text-brand-400/50'}`} />
                  </div>
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
                      : owned || used
                        ? 'bg-white/5 text-slate-400'
                        : 'bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-brand hover:brightness-110 hover:scale-[1.02] active:scale-[0.98]'
                  }`}
                >
                  {isBuying && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  {success ? 'Подключено' : owned ? 'Уже подключена' : used ? 'Уже использовалась' : isBuying ? 'Покупаем…' : 'Подключить тариф'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* ── My Services ── */}
      {myServices.length > 0 && (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Мои услуги</h2>
            <p className="mt-1 text-sm text-slate-400">
              Настройка подключения доступна через deeplink и автоматический setup flow.
            </p>
          </div>

          <div className="space-y-3">
            {myServices.map(svc => {
              const isActioning = actionLoading === svc.id
              return (
                <div
                  key={svc.id}
                  className={`glass rounded-[1.75rem] p-4 sm:p-5 ${svc.status === 1 ? 'ring-1 ring-emerald-500/25' : ''}`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold text-white">{svc.name}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          svc.status === 1 ? 'bg-emerald-500/15 text-emerald-100'
                          : svc.status === 3 ? 'bg-rose-500/15 text-rose-100'
                          : 'bg-amber-500/15 text-amber-100'
                        }`}>
                          {svc.status === 1 ? 'Активна' : svc.status === 3 ? 'Удалена' : 'Заблокирована'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-300">
                        <span>ID услуги: <span className="font-mono text-white">{svc.id}</span></span>
                        <span>Тариф: <span className="font-mono text-white">{svc.service_id}</span></span>
                        {svc.expired && (
                          <span>Истекает: <span className="text-white">{svc.expired.replace('T', ' ').split(' ')[0]}</span></span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => setSetupTarget(
                        svc.subscription_url ? { url: svc.subscription_url } : { serviceId: svc.id ?? undefined }
                      )}
                      className="w-full rounded-2xl border border-emerald-300/20 bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-50 hover:bg-emerald-500/25 hover:brightness-110 transition-all lg:w-auto"
                    >
                      Настроить подключение
                    </button>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <button
                      onClick={() => setChangingId(svc.id ?? null)}
                      disabled={isActioning}
                      className="rounded-2xl bg-brand-500/18 px-4 py-3 text-sm font-medium text-white hover:brightness-110 transition-all disabled:opacity-40"
                    >
                      Сменить тариф
                    </button>
                    <button
                      onClick={() => handleStop(svc)}
                      disabled={isActioning || svc.status !== 1}
                      className="rounded-2xl bg-amber-500/15 px-4 py-3 text-sm font-medium text-amber-100 hover:brightness-110 transition-all disabled:opacity-40"
                    >
                      {isActioning ? 'Выполняем…' : 'Остановить'}
                    </button>
                    <button
                      onClick={() => handleDelete(svc)}
                      disabled={isActioning}
                      className="rounded-2xl bg-rose-500/15 px-4 py-3 text-sm font-medium text-rose-100 hover:brightness-110 transition-all disabled:opacity-40"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function StatusPill({ owned, used }: { owned: boolean; used: boolean }) {
  if (owned) return <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-100">Активна</span>
  if (used) return <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-slate-300">Уже была</span>
  return <span className="rounded-full bg-brand-500/15 px-3 py-1 text-xs font-medium text-fuchsia-100">Доступна</span>
}

function HeroStatCard({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-black/30 backdrop-blur-sm p-4 text-center ${active ? 'animate-glow-pulse' : ''}`}>
      <div className="text-2xl font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
    </div>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
    </svg>
  )
}
