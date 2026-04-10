import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchServices, buyService } from '../api/services'
import { fetchUserServices, changeService, stopService, deleteService } from '../api/user'
import { useToast } from '../components/Toast'
import SetupGuide from '../components/SetupGuide'
import type { Service, UserService } from '../types'

function SubUrl({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-2 pt-2 border-t border-white/5 flex items-center gap-2">
      <code className="flex-1 text-xs text-brand-300 font-mono truncate min-w-0">{url}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="flex-shrink-0 text-xs px-2 py-1 rounded-lg bg-brand-600/15 text-brand-400 hover:bg-brand-600/25 transition-colors whitespace-nowrap"
      >
        {copied ? '✓ Скопировано' : 'Скопировать'}
      </button>
    </div>
  )
}

// ---- Modal for changing tariff ----
function ChangeTariffModal({ svc, catalog, onClose, onChanged }: {
  svc: UserService
  catalog: Service[]
  onClose: () => void
  onChanged: () => void
}) {
  const { show } = useToast()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const available = catalog.filter(s => s.status === 1 && s.service_id !== svc.service_id)

  const handleChange = async () => {
    if (!selectedId || !svc.id) return
    setLoading(true)
    try {
      await changeService(svc.id, selectedId)
      show('Тариф изменён', 'success')
      onChanged()
      onClose()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка смены тарифа', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl p-6 w-full max-w-sm space-y-4 animate-slide-up">
        <div>
          <h2 className="font-bold text-white text-base">Сменить тариф</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Текущий: <span className="text-slate-300">{svc.name}</span>
            {' '}· user_service_id: <span className="font-mono text-slate-400">{svc.id}</span>
          </p>
        </div>

        {available.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Нет доступных тарифов для смены</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {available.map(s => (
              <button
                key={s.service_id}
                onClick={() => setSelectedId(s.service_id)}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                  selectedId === s.service_id
                    ? 'bg-brand-600/20 border-brand-500/40 text-white'
                    : 'bg-surface-3 border-white/8 text-slate-300 hover:border-white/20'
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  {s.cost} ₽ · service_id: {s.service_id}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-surface-3 text-slate-400 text-sm font-medium hover:text-white transition-colors">
            Отмена
          </button>
          <button onClick={handleChange} disabled={!selectedId || loading}
            className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-all disabled:opacity-50 flex items-center justify-center gap-1.5">
            {loading && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Сменить
          </button>
        </div>
      </div>
    </div>
  )
}

function periodLabel(period: number, type: string) {
  if (type === 'month') return period === 1 ? '/мес'  : `/${period} мес`
  if (type === 'year')  return period === 1 ? '/год'  : `/${period} г`
  return period === 1 ? '/день' : `/${period} дн`
}

export default function ServicesPage() {
  const { show } = useToast()
  const navigate = useNavigate()
  const [catalog,    setCatalog]    = useState<Service[]>([])
  const [myServices, setMyServices] = useState<UserService[]>([])
  const [loading,    setLoading]    = useState(true)
  const [buying,     setBuying]     = useState<number | null>(null)
  const [justBought, setJustBought] = useState<Set<number>>(new Set())
  const [filter,     setFilter]     = useState<'all' | 'available' | 'mine'>('all')
  const [changingId, setChangingId] = useState<number | null>(null)  // user_service_id for modal
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [topupPrompt, setTopupPrompt] = useState<{ amount: number; balance: number } | null>(null)
  const [setupTarget, setSetupTarget] = useState<{ url?: string; serviceId?: number } | null>(null)

  const reload = async () => {
    const [cat, svcs] = await Promise.all([fetchServices(), fetchUserServices()])
    setCatalog(cat)
    setMyServices(svcs)
  }

  useEffect(() => {
    Promise.all([fetchServices(), fetchUserServices()])
      .then(([cat, svcs]) => { setCatalog(cat); setMyServices(svcs) })
      .catch(() => show('Ошибка загрузки каталога', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const myActiveIds = new Set(myServices.filter(s => s.status === 1).map(s => s.service_id))

  const handleBuy = async (service_id: number) => {
    setBuying(service_id)
    try {
      const res = await buyService(service_id)
      const updated = await fetchUserServices()
      setMyServices(updated)
      if (res?.needs_topup) {
        setTopupPrompt({ amount: res.amount_needed, balance: res.balance })
      } else {
        setJustBought(prev => new Set([...prev, service_id]))
        show('Услуга успешно подключена!', 'success')
        setTimeout(() => {
          setJustBought(prev => { const s = new Set(prev); s.delete(service_id); return s })
        }, 4000)
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
      show('Услуга остановлена', 'success')
      await reload()
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
      show('Услуга удалена', 'success')
      await reload()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка удаления', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const activeCatalog = catalog.filter(s => s.status === 1)
  const filtered = activeCatalog.filter(s => {
    if (filter === 'mine')      return myActiveIds.has(s.service_id)
    if (filter === 'available') return !myActiveIds.has(s.service_id)
    return true
  })

  const changingSvc = changingId !== null ? myServices.find(s => s.id === changingId) : null

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="h-7 w-40 bg-surface-2 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-48 rounded-xl bg-surface-2 animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Change tariff modal */}
      {changingSvc && (
        <ChangeTariffModal
          svc={changingSvc}
          catalog={catalog}
          onClose={() => setChangingId(null)}
          onChanged={reload}
        />
      )}

      {/* Setup guide modal */}
      {setupTarget && (
        <SetupGuide
          subUrl={setupTarget.url}
          serviceId={setupTarget.serviceId}
          onClose={() => setSetupTarget(null)}
        />
      )}

      {/* Top-up prompt modal */}
      {topupPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setTopupPrompt(null)} />
          <div className="relative glass rounded-2xl p-6 w-full max-w-sm space-y-4 animate-slide-up">
            <div className="text-center">
              <div className="text-3xl mb-3">💳</div>
              <h2 className="font-bold text-white text-base">Недостаточно средств</h2>
              <p className="text-sm text-slate-400 mt-1.5">
                Услуга зарегистрирована и ожидает оплаты.
              </p>
            </div>
            <div className="bg-surface-3 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Ваш баланс</span>
                <span className="text-white font-mono">{topupPrompt.balance.toFixed(2)} ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Нужно пополнить</span>
                <span className="text-amber-400 font-mono font-semibold">{topupPrompt.amount.toFixed(2)} ₽</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setTopupPrompt(null)}
                className="flex-1 py-2.5 rounded-xl bg-surface-3 text-slate-400 text-sm font-medium hover:text-white transition-colors">
                Позже
              </button>
              <button
                onClick={() => { setTopupPrompt(null); navigate('/payments') }}
                className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-all">
                Пополнить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Каталог тарифов</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCatalog.length} тариф{activeCatalog.length === 1 ? '' : 'а'} доступно
          </p>
        </div>
        <div className="flex gap-1 p-1 bg-surface-2 rounded-xl">
          {([
            { key: 'all',       label: 'Все' },
            { key: 'available', label: 'Доступные' },
            { key: 'mine',      label: 'Мои' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                filter === key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog grid */}
      {filtered.length === 0 ? (
        <div className="glass rounded-xl p-12 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-slate-400 text-sm">Ничего не найдено</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(svc => {
            const owned   = myActiveIds.has(svc.service_id)
            const isBuying = buying === svc.service_id
            const success  = justBought.has(svc.service_id)
            return (
              <div key={svc.service_id}
                className={`glass glass-hover rounded-xl p-5 flex flex-col gap-3 transition-all animate-slide-up ${owned ? 'border-emerald-500/20' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-sm leading-snug">{svc.name}</p>
                    {svc.category && <span className="text-xs text-slate-500 mt-0.5 block">{svc.category}</span>}
                  </div>
                  {owned && (
                    <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">Активна</span>
                  )}
                </div>
                {svc.descr && <p className="text-xs text-slate-500 leading-relaxed">{svc.descr}</p>}
                <div className="mt-auto pt-3 border-t border-white/5 flex items-end justify-between gap-2">
                  <div>
                    <span className="text-2xl font-bold font-mono gradient-text">{svc.cost}</span>
                    <span className="text-slate-500 text-xs"> ₽{periodLabel(svc.period, svc.period_type)}</span>
                  </div>
                  <button
                    onClick={() => !owned && !isBuying && handleBuy(svc.service_id)}
                    disabled={owned || isBuying}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                      success ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                      : owned  ? 'bg-surface-3 text-slate-600 cursor-default border border-white/5'
                      : isBuying ? 'bg-brand-600/50 text-white cursor-wait'
                      : 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-600/20'
                    }`}>
                    {success ? '✓ Куплено' : owned ? 'Подключена' : isBuying
                      ? <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />...</span>
                      : 'Купить'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* My services with management */}
      {myServices.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Мои подключённые услуги</h2>
          <div className="space-y-2">
            {myServices.map(svc => {
              const isActioning = actionLoading === svc.id
              return (
                <div key={svc.id} className="glass rounded-xl px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-sm text-white font-medium block truncate">{svc.name}</span>
                      <span className="text-xs text-slate-600 font-mono">
                        id: {svc.id} · svc: {svc.service_id}
                      </span>
                      {svc.expired && (
                        <span className="text-xs text-slate-500 block">
                          Истекает: {svc.expired.replace('T', ' ').split(' ')[0]}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${
                        svc.status === 1 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : svc.status === 3 ? 'bg-red-500/10 text-red-400 border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {svc.status === 1 ? 'Активна' : svc.status === 3 ? 'Удалена' : 'Блокирована'}
                      </span>
                    </div>
                  </div>

                  {svc.subscription_url && <SubUrl url={svc.subscription_url} />}

                  {/* Action buttons */}
                  <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-white/5">
                    <button
                      onClick={() => setSetupTarget(
                        svc.subscription_url
                          ? { url: svc.subscription_url }
                          : { serviceId: svc.id ?? undefined }
                      )}
                      className="w-full py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 text-xs font-semibold transition-colors border border-emerald-500/20"
                    >
                      Настроить подключение
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setChangingId(svc.id ?? null)}
                        disabled={isActioning}
                        className="flex-1 py-1.5 rounded-lg bg-brand-600/15 text-brand-400 hover:bg-brand-600/25 text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        Сменить тариф
                      </button>
                      <button
                        onClick={() => handleStop(svc)}
                        disabled={isActioning || svc.status !== 1}
                        className="flex-1 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        {isActioning ? '...' : 'Остановить'}
                      </button>
                      <button
                        onClick={() => handleDelete(svc)}
                        disabled={isActioning}
                        className="flex-1 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-colors disabled:opacity-40"
                      >
                        Удалить
                      </button>
                    </div>
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
