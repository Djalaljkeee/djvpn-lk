import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import { fetchUserServices, fetchProfile } from '../api/user'
import type { UserService } from '../types'
import { format, parseISO, differenceInDays, isPast } from 'date-fns'
import { ru } from 'date-fns/locale'

function StatusBadge({ status }: { status: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    1: { label: 'Активна',     cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
    2: { label: 'Заблокирована', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    3: { label: 'Удалена',     cls: 'bg-red-500/15 text-red-400 border-red-500/25' },
  }
  const s = map[status] ?? { label: 'Неизвестно', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/25' }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium border ${s.cls}`}>
      {s.label}
    </span>
  )
}

function ServiceCard({ svc }: { svc: UserService }) {
  const expiredAt  = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const daysLeft   = expiredAt ? differenceInDays(expiredAt, new Date()) : null
  const isExpired  = expiredAt ? isPast(expiredAt) : false
  const isUrgent   = !isExpired && daysLeft !== null && daysLeft <= 5

  return (
    <div className="glass glass-hover rounded-xl p-4 transition-all animate-slide-up group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-white text-sm truncate">{svc.name}</p>
          {svc.descr && <p className="text-xs text-slate-500 mt-0.5 truncate">{svc.descr}</p>}
        </div>
        <StatusBadge status={svc.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span>Создана: {svc.created ? format(parseISO(svc.created.replace(' ', 'T')), 'd MMM yyyy', { locale: ru }) : '—'}</span>
        {expiredAt && (
          <span className={isExpired ? 'text-red-400 font-medium' : isUrgent ? 'text-amber-400 font-medium' : ''}>
            {isExpired ? '🔴 Истекла: ' : isUrgent ? '⚠ До: ' : 'До: '}
            {format(expiredAt, 'd MMM yyyy', { locale: ru })}
            {daysLeft !== null && !isExpired && ` (${daysLeft} д.)`}
          </span>
        )}
        {svc.cost !== undefined && (
          <span className="font-mono text-brand-400 ml-auto">
            {svc.cost} ₽/{svc.period_type === 'month' ? 'мес' : svc.period_type === 'year' ? 'год' : 'день'}
          </span>
        )}
      </div>
    </div>
  )
}

function StatCard({
  label, value, valueClass = 'text-white', icon, action,
}: {
  label: string; value: string; valueClass?: string
  icon: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-brand-600/15 flex items-center justify-center text-brand-400 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500 mb-0.5">{label}</p>
        <p className={`text-xl font-bold font-mono ${valueClass}`}>{value}</p>
      </div>
      {action}
    </div>
  )
}

export default function DashboardPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [services, setServices] = useState<UserService[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([
      fetchProfile().then(setUser),
      fetchUserServices().then(setServices),
    ])
      .catch(() => show('Не удалось загрузить данные', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const balance        = user?.balance ?? 0
  const activeServices = services.filter(s => s.status === 1)
  const urgentServices = activeServices.filter(s => {
    if (!s.expired) return false
    const d = differenceInDays(parseISO(s.expired.replace(' ', 'T')), new Date())
    return d <= 5
  })

  const refLink = user ? `${window.location.origin}/?partner_id=${user.user_id}` : ''

  const copyRef = () => {
    if (!refLink) return
    navigator.clipboard.writeText(refLink)
    show('Ссылка скопирована!', 'success')
  }

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Urgent expiry banner */}
      {urgentServices.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 animate-slide-up">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-medium text-amber-300">Скоро истекут услуги</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              {urgentServices.map(s => s.name).join(', ')}
            </p>
          </div>
          <Link to="/payments" className="ml-auto flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors font-medium">
            Продлить
          </Link>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Баланс"
          value={`${balance.toFixed(2)} ₽`}
          valueClass="text-brand-400"
          icon={<WalletIcon />}
          action={
            <Link to="/payments" className="flex-shrink-0 text-xs text-brand-400 hover:text-brand-300 transition-colors whitespace-nowrap">
              Пополнить →
            </Link>
          }
        />
        <StatCard
          label="Активных услуг"
          value={String(activeServices.length)}
          icon={<BoxIcon />}
          action={
            <Link to="/services" className="flex-shrink-0 text-xs text-brand-400 hover:text-brand-300 transition-colors whitespace-nowrap">
              Каталог →
            </Link>
          }
        />
        <StatCard
          label="Всего услуг"
          value={String(services.length)}
          icon={<ListIcon />}
        />
      </div>

      {/* Services list */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Мои услуги</h2>
          <Link to="/services" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
            Все тарифы →
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl bg-surface-2 animate-pulse" />
            ))}
          </div>
        ) : services.length === 0 ? (
          <div className="glass rounded-xl p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <p className="text-slate-400 text-sm mb-4">У вас пока нет услуг</p>
            <Link
              to="/services"
              className="inline-flex px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 transition-colors shadow-lg shadow-brand-600/20"
            >
              Выбрать тариф
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {services.map(svc => <ServiceCard key={svc.id} svc={svc} />)}
          </div>
        )}
      </section>

      {/* Referral block */}
      {user && (
        <section>
          <div className="glass rounded-xl p-5 bg-gradient-to-br from-brand-600/8 to-purple-600/5 border-brand-600/15">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-semibold text-white text-sm mb-1">Реферальная программа</p>
                <p className="text-xs text-slate-500">
                  Получайте бонусы со всех платежей приглашённых друзей
                </p>
              </div>
              <Link
                to="/referrals"
                className="flex-shrink-0 px-4 py-2 rounded-xl bg-brand-600/20 text-brand-400 text-sm font-medium border border-brand-600/25 hover:bg-brand-600/30 transition-colors"
              >
                Подробнее
              </Link>
            </div>
            {refLink && (
              <div className="mt-3 flex items-center gap-2">
                <code className="flex-1 text-xs text-slate-400 bg-surface-3/80 px-3 py-2 rounded-lg font-mono truncate border border-white/5">
                  {refLink}
                </code>
                <button
                  onClick={copyRef}
                  className="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                  title="Копировать ссылку"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function WalletIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
  </svg>
}
function BoxIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
  </svg>
}
function ListIcon() {
  return <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
  </svg>
}
