import { useEffect, useState } from 'react'
import { fetchServices, buyService } from '../api/services'
import { fetchUserServices } from '../api/user'
import { useToast } from '../components/Toast'
import type { Service, UserService } from '../types'

function periodLabel(period: number, type: string) {
  if (type === 'month') return period === 1 ? '/мес'  : `/${period} мес`
  if (type === 'year')  return period === 1 ? '/год'  : `/${period} г`
  return period === 1 ? '/день' : `/${period} дн`
}

export default function ServicesPage() {
  const { show } = useToast()
  const [catalog,    setCatalog]    = useState<Service[]>([])
  const [myServices, setMyServices] = useState<UserService[]>([])
  const [loading,    setLoading]    = useState(true)
  const [buying,     setBuying]     = useState<number | null>(null)
  const [justBought, setJustBought] = useState<Set<number>>(new Set())
  const [filter,     setFilter]     = useState<'all' | 'available' | 'mine'>('all')

  useEffect(() => {
    Promise.all([
      fetchServices().then(setCatalog),
      fetchUserServices().then(setMyServices),
    ])
      .catch(() => show('Ошибка загрузки каталога', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const myActiveIds = new Set(myServices.filter(s => s.status === 1).map(s => s.service_id))

  const handleBuy = async (service_id: number) => {
    setBuying(service_id)
    try {
      await buyService(service_id)
      setJustBought(prev => new Set([...prev, service_id]))
      const updated = await fetchUserServices()
      setMyServices(updated)
      show('Услуга успешно подключена!', 'success')
      setTimeout(() => {
        setJustBought(prev => { const s = new Set(prev); s.delete(service_id); return s })
      }, 4000)
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Ошибка при покупке услуги', 'error')
    } finally {
      setBuying(null)
    }
  }

  const activeCatalog = catalog.filter(s => s.status === 1)
  const filtered = activeCatalog.filter(s => {
    if (filter === 'mine')      return myActiveIds.has(s.service_id)
    if (filter === 'available') return !myActiveIds.has(s.service_id)
    return true
  })

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
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Каталог тарифов</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeCatalog.length} тариф{activeCatalog.length === 1 ? '' : 'а'} доступно
          </p>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1 p-1 bg-surface-2 rounded-xl">
          {([
            { key: 'all',       label: 'Все' },
            { key: 'available', label: 'Доступные' },
            { key: 'mine',      label: 'Мои' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                filter === key
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
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
              <div
                key={svc.service_id}
                className={`glass glass-hover rounded-xl p-5 flex flex-col gap-3 transition-all animate-slide-up ${
                  owned ? 'border-emerald-500/20' : ''
                }`}
              >
                {/* Top */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-sm leading-snug">{svc.name}</p>
                    {svc.category && (
                      <span className="text-xs text-slate-500 mt-0.5 block">{svc.category}</span>
                    )}
                  </div>
                  {owned && (
                    <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                      Активна
                    </span>
                  )}
                </div>

                {svc.descr && (
                  <p className="text-xs text-slate-500 leading-relaxed">{svc.descr}</p>
                )}

                {/* Price + button */}
                <div className="mt-auto pt-3 border-t border-white/5 flex items-end justify-between gap-2">
                  <div>
                    <span className="text-2xl font-bold font-mono gradient-text">{svc.cost}</span>
                    <span className="text-slate-500 text-xs"> ₽{periodLabel(svc.period, svc.period_type)}</span>
                  </div>
                  <button
                    onClick={() => !owned && !isBuying && handleBuy(svc.service_id)}
                    disabled={owned || isBuying}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                      success
                        ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                        : owned
                        ? 'bg-surface-3 text-slate-600 cursor-default border border-white/5'
                        : isBuying
                        ? 'bg-brand-600/50 text-white cursor-wait'
                        : 'bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-600/20'
                    }`}
                  >
                    {success ? '✓ Куплено' : owned ? 'Подключена' : isBuying ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
                        ...
                      </span>
                    ) : 'Купить'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* My active services quick list */}
      {myServices.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-white mb-3">Мои подключённые услуги</h2>
          <div className="space-y-2">
            {myServices.map(svc => (
              <div key={svc.id} className="glass rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm text-white font-medium block truncate">{svc.name}</span>
                  {svc.expired && (
                    <span className="text-xs text-slate-500">
                      Истекает: {svc.expired.split('T')[0]}
                    </span>
                  )}
                </div>
                <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-md border ${
                  svc.status === 1
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {svc.status === 1 ? 'Активна' : 'Блокирована'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
