import { useEffect, useState } from 'react'
import { fetchReferrals } from '../api/user'
import { fetchConfig } from '../api/services'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

interface Referral {
  user_id?: number
  login?: string
  name?: string
  created?: string
  income?: number
}

export default function ReferralsPage() {
  const { user } = useAuthStore()
  const { show } = useToast()
  const [referrals,    setReferrals]    = useState<Referral[]>([])
  const [loading,      setLoading]      = useState(true)
  const [botUsername,  setBotUsername]  = useState('')

  useEffect(() => {
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
    fetchReferrals()
      .then(data => setReferrals(Array.isArray(data) ? data : (data?.referrals ?? [])))
      .catch(() => show('Ошибка загрузки рефералов', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const webRefLink = user ? `${window.location.origin}/?partner_id=${user.user_id}` : ''
  const tgRefLink  = user && botUsername ? `https://t.me/${botUsername}?start=${user.user_id}` : ''
  const totalIncome = referrals.reduce((sum, r) => sum + (r.income ?? 0), 0)

  const copyLink = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    show(`${label} скопирована!`, 'success')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Реферальная программа</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Приглашайте друзей и получайте бонусы с каждого их платежа
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="glass rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Рефералов</p>
          <p className="text-3xl font-bold font-mono text-white">{referrals.length}</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-xs text-slate-500 mb-1">Заработано</p>
          <p className="text-3xl font-bold font-mono gradient-text">{totalIncome.toFixed(2)} ₽</p>
        </div>
        <div className="glass rounded-xl p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-500 mb-1">Ваш ID</p>
          <p className="text-3xl font-bold font-mono text-slate-300">{user?.user_id ?? '—'}</p>
        </div>
      </div>

      {/* How it works */}
      <div className="glass rounded-xl p-5 bg-gradient-to-br from-brand-600/8 to-transparent">
        <h2 className="font-semibold text-white text-sm mb-3">Как это работает</h2>
        <div className="space-y-2.5">
          {[
            { step: '1', text: 'Поделитесь своей реферальной ссылкой с другом' },
            { step: '2', text: 'Друг регистрируется и оформляет подписку' },
            { step: '3', text: 'Вы получаете бонус с каждого его платежа автоматически' },
          ].map(({ step, text }) => (
            <div key={step} className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-brand-600/30 border border-brand-600/40 flex items-center justify-center text-xs font-bold text-brand-400 flex-shrink-0 mt-0.5">
                {step}
              </div>
              <p className="text-sm text-slate-400 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Ref links */}
      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-white text-sm">Ваши реферальные ссылки</h2>

        {[
          { label: 'Ссылка на сайт', link: webRefLink, copyLabel: 'Ссылка на сайт' },
          { label: 'Ссылка в Telegram', link: tgRefLink, copyLabel: 'Ссылка в Telegram' },
        ].map(({ label, link, copyLabel }) => (
          <div key={label}>
            <p className="text-xs text-slate-500 mb-1.5 font-medium">{label}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-slate-300 bg-surface-3 border border-white/8 px-3 py-2.5 rounded-xl font-mono truncate">
                {link || '—'}
              </code>
              <button
                onClick={() => copyLink(link, copyLabel)}
                disabled={!link}
                className="flex-shrink-0 px-3 py-2.5 rounded-xl bg-brand-600/20 text-brand-400 text-xs font-medium border border-brand-600/25 hover:bg-brand-600/30 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Копировать
              </button>
            </div>
          </div>
        ))}

        <p className="text-xs text-slate-600 leading-relaxed pt-1">
          💡 Бонусы начисляются на ваш баланс автоматически после каждой оплаты реферала.
        </p>
      </div>

      {/* Referrals table */}
      <section>
        <h2 className="text-base font-semibold text-white mb-3">Мои рефералы</h2>

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-surface-2" />)}
          </div>
        ) : referrals.length === 0 ? (
          <div className="glass rounded-xl p-12 text-center">
            <div className="text-5xl mb-3">🤝</div>
            <p className="text-slate-400 text-sm mb-1">У вас пока нет рефералов</p>
            <p className="text-slate-600 text-xs">Поделитесь ссылкой — и начните зарабатывать</p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden sm:grid grid-cols-4 gap-3 px-4 mb-1">
              {['Пользователь', 'Логин', 'Дата регистрации', 'Доход'].map(h => (
                <p key={h} className="text-xs text-slate-600 font-medium">{h}</p>
              ))}
            </div>

            <div className="space-y-2">
              {referrals.map((ref, idx) => {
                const displayName = ref.name || ref.login || `#${ref.user_id ?? idx}`
                const initials    = displayName[0].toUpperCase()

                return (
                  <div key={ref.user_id ?? idx} className="glass rounded-xl px-4 py-3 grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3 items-center animate-slide-up">
                    {/* Avatar + name */}
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-600/40 to-purple-600/40 flex items-center justify-center text-xs font-bold text-brand-300 flex-shrink-0">
                        {initials}
                      </div>
                      <span className="text-sm text-white font-medium truncate">{displayName}</span>
                    </div>
                    {/* Login */}
                    <span className="text-xs text-slate-500 font-mono truncate hidden sm:block">
                      {ref.login || '—'}
                    </span>
                    {/* Date */}
                    <span className="text-xs text-slate-500 hidden sm:block">
                      {ref.created
                        ? format(parseISO(ref.created), 'd MMM yyyy', { locale: ru })
                        : '—'}
                    </span>
                    {/* Income */}
                    <span className={`text-sm font-mono font-semibold ${(ref.income ?? 0) > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                      +{(ref.income ?? 0).toFixed(2)} ₽
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Total row */}
            <div className="mt-3 px-4 py-3 rounded-xl bg-surface-3 border border-white/5 flex items-center justify-between">
              <span className="text-sm text-slate-400">Итого заработано</span>
              <span className="text-sm font-mono font-bold text-emerald-400">+{totalIncome.toFixed(2)} ₽</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
