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
    1: { label: 'Активна', cls: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25' },
    2: { label: 'Заблокирована', cls: 'bg-amber-500/15 text-amber-100 border-amber-500/25' },
    3: { label: 'Удалена', cls: 'bg-rose-500/15 text-rose-100 border-rose-500/25' },
  }
  const state = map[status] ?? { label: 'Неизвестно', cls: 'bg-white/10 text-slate-100 border-white/10' }
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${state.cls}`}>{state.label}</span>
}

function ServiceCard({ svc }: { svc: UserService }) {
  const expiredAt = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const daysLeft = expiredAt ? differenceInDays(expiredAt, new Date()) : null
  const isExpired = expiredAt ? isPast(expiredAt) : false
  const isUrgent = !isExpired && daysLeft !== null && daysLeft <= 5

  return (
    <div className="glass glass-hover rounded-[1.75rem] p-5 animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">{svc.name}</div>
          {svc.descr && <div className="mt-1 text-sm leading-6 text-slate-300">{svc.descr}</div>}
        </div>
        <StatusBadge status={svc.status} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Info label="Создана" value={svc.created ? format(parseISO(svc.created.replace(' ', 'T')), 'd MMM yyyy', { locale: ru }) : '—'} />
        <Info label="Истекает" value={expiredAt ? format(expiredAt, 'd MMM yyyy', { locale: ru }) : '—'} accent={isExpired ? 'text-rose-200' : isUrgent ? 'text-amber-100' : 'text-white'} />
        <Info
          label="Стоимость"
          value={svc.cost !== undefined ? `${svc.cost} ₽/${svc.period_type === 'month' ? 'мес' : svc.period_type === 'year' ? 'год' : 'день'}` : '—'}
          accent="text-fuchsia-100"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
        Для настройки подключения используйте deeplink через экран услуг. Сырые ссылки подписки в интерфейсе больше не показываем.
      </div>
    </div>
  )
}

function Info({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-sm font-medium ${accent}`}>{value}</div>
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  action,
}: {
  label: string
  value: string
  icon: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="glass rounded-[1.75rem] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500/15 text-fuchsia-100">
          {icon}
        </div>
        {action}
      </div>
      <div className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-white">{value}</div>
    </div>
  )
}

export default function DashboardPage() {
  const { user, setUser } = useAuthStore()
  const { show } = useToast()
  const [services, setServices] = useState<UserService[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchProfile().then(setUser),
      fetchUserServices().then(setServices),
    ])
      .catch(() => show('Не удалось загрузить данные', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const balance = user?.balance ?? 0
  const activeServices = services.filter(s => s.status === 1)
  const urgentServices = activeServices.filter(s => {
    if (!s.expired) return false
    const days = differenceInDays(parseISO(s.expired.replace(' ', 'T')), new Date())
    return days <= 5
  })
  return (
    <div className="space-y-6 animate-fade-in">
      {urgentServices.length > 0 && (
        <div className="rounded-[1.75rem] border border-amber-300/20 bg-amber-500/10 p-4 text-amber-50">
          <div className="text-sm font-semibold">Скоро истекают услуги</div>
          <div className="mt-1 text-sm text-amber-100/90">{urgentServices.map(s => s.name).join(', ')}</div>
        </div>
      )}

      <section className="brand-panel rounded-[2rem] p-5 sm:p-6">
        <div className="text-sm uppercase tracking-[0.35em] text-fuchsia-100/70">DJ VPN dashboard</div>
        <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Главное по аккаунту и услугам в одном месте.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
          Здесь собраны баланс, количество активных услуг и быстрый переход к настройке и оплате без лишних кликов.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Баланс"
          value={`${balance.toFixed(2)} ₽`}
          icon={<WalletIcon />}
          action={<Link to="/payments" className="text-sm text-fuchsia-100">Оплата</Link>}
        />
        <StatCard
          label="Активных услуг"
          value={String(activeServices.length)}
          icon={<BoxIcon />}
          action={<Link to="/services" className="text-sm text-fuchsia-100">Тарифы</Link>}
        />
        <StatCard
          label="Всего услуг"
          value={String(services.length)}
          icon={<ListIcon />}
        />
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Мои услуги</h2>
            <p className="mt-1 text-sm text-slate-300">Подключение настраивается через deeplink с экрана услуг.</p>
          </div>
          <Link to="/services" className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-white hover:bg-white/10">
            Открыть услуги
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(item => <div key={item} className="h-40 rounded-[1.75rem] bg-white/5 animate-pulse" />)}
          </div>
        ) : services.length === 0 ? (
          <div className="glass rounded-[2rem] p-10 text-center">
            <div className="text-5xl">📦</div>
            <p className="mt-3 text-sm text-slate-300">У вас пока нет услуг.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {services.map(svc => <ServiceCard key={svc.id} svc={svc} />)}
          </div>
        )}
      </section>

      {user && (
        <section className="glass rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Реферальная программа</h2>
              <p className="mt-1 text-sm text-slate-300">Делитесь deeplink и отслеживайте статистику на отдельном экране.</p>
            </div>
            <Link to="/referrals" className="rounded-2xl bg-brand-500/18 px-4 py-3 text-sm font-semibold text-white">
              Перейти к рефералам
            </Link>
          </div>

          <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-300">
            Deeplink и фактическая статистика рефералов вынесены на отдельный экран, чтобы не дублировать старую web-ссылку и не путать пользователя.
          </div>
        </section>
      )}
    </div>
  )
}

function WalletIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" /></svg>
}

function BoxIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
}

function ListIcon() {
  return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
}
