import { useEffect, useMemo, useState } from 'react'
import { fetchReferrals } from '../api/user'
import { fetchConfig } from '../api/services'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { ReferralStats } from '../types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const SUPPORT_URL = 'https://t.me/help_djvpn'
const REFERRALS_PAGE_SIZE = 25

export default function ReferralsPage() {
  const { user } = useAuthStore()
  const { show } = useToast()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [botUsername, setBotUsername] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    fetchReferrals(user.user_id)
      .then(setStats)
      .catch(() => show('Ошибка загрузки реферальной статистики', 'error'))
      .finally(() => setLoading(false))
  }, [user?.user_id])

  const tgRefLink = user && botUsername ? `https://t.me/${botUsername}?start=${user.user_id}` : ''
  const webRefLink = user && typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${user.user_id}`
    : ''

  const commission = stats?.commission ?? 15
  const totalReferrals = stats?.total_referrals ?? 0
  const totalIncome = stats?.total_income ?? 0
  const totalPaid = stats?.total_paid ?? 0

  // Сортируем по доходу убыванию (топ-плательщики наверху); вторичный ключ —
  // user_id desc для стабильного порядка среди нулевых income.
  const sortedReferrals = useMemo(() => {
    const list = [...(stats?.referrals ?? [])]
    list.sort((a, b) => (b.income - a.income) || ((b.user_id ?? 0) - (a.user_id ?? 0)))
    return list
  }, [stats?.referrals])

  const pages = Math.max(1, Math.ceil(sortedReferrals.length / REFERRALS_PAGE_SIZE))
  const pageSafe = Math.min(page, pages - 1)
  const start = pageSafe * REFERRALS_PAGE_SIZE
  const pageItems = sortedReferrals.slice(start, start + REFERRALS_PAGE_SIZE)

  const copyLink = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    show(`${label} скопирована`, 'success')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="brand-panel rounded-[2rem] p-6 sm:p-8">
          <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
            Реферальная<br />
            <span className="gradient-text">программа</span>
          </h1>
          <p className="mt-4 max-w-md text-base font-medium leading-7 text-white">
            Получайте {commission}% с каждого пополнения приглашённых пользователей.
          </p>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-300">
            Поделитесь своей ссылкой и бонусы будут автоматически начисляться на ваш баланс.
          </p>
        </div>

        <div className="glass flex flex-col justify-center rounded-[2rem] p-6 sm:p-8">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/20 text-fuchsia-100">
              <WalletIcon className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-slate-300">Заработано</div>
              {loading ? (
                <div className="mt-2 h-10 w-40 animate-pulse rounded-xl bg-white/10" />
              ) : (
                <div className="text-4xl font-bold text-white sm:text-5xl">{totalIncome.toFixed(2)} ₽</div>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm text-slate-300">
            Всего бонусов по реферальной программе
          </p>
        </div>
      </section>

      {/* Метрики: оплачено рефералами + количество приглашённых */}
      <section className="grid gap-4 sm:grid-cols-2">
        <StatCard
          icon={<CoinsIcon className="h-6 w-6" />}
          label="Оплачено рефералами"
          value={loading ? null : `${totalPaid.toFixed(2)} ₽`}
          hint="Суммарный оборот приглашённых"
        />
        <StatCard
          icon={<UsersIcon className="h-6 w-6" />}
          label="Приглашено"
          value={loading ? null : String(totalReferrals)}
          hint="Всего рефералов по вашей ссылке"
        />
      </section>

      <section className="glass rounded-[2rem] p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-white">Ваша реферальная ссылка</h2>
        <div className="mt-5 space-y-4">
          <LinkRow
            icon={<LinkIcon className="h-5 w-5" />}
            label="Реферальная ссылка"
            value={webRefLink || 'Ссылка появится после загрузки профиля.'}
            buttonLabel="Скопировать ссылку"
            primary
            disabled={!webRefLink}
            onCopy={() => webRefLink && copyLink(webRefLink, 'Ссылка на ЛК')}
          />
          <LinkRow
            icon={<TelegramIcon className="h-5 w-5" />}
            label="Telegram Deeplink"
            value={tgRefLink || 'Ссылка появится после загрузки профиля и конфигурации бота.'}
            buttonLabel="Скопировать Deeplink"
            disabled={!tgRefLink}
            onCopy={() => tgRefLink && copyLink(tgRefLink, 'Telegram ссылка')}
          />
        </div>
      </section>

      {/* Детализированный список рефералов */}
      <section className="glass rounded-[2rem] overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-6">
          <h2 className="text-xl font-semibold text-white">Ваши рефералы</h2>
          {!loading && totalReferrals > 0 && (
            <span className="rounded-full bg-brand-500/20 px-3 py-1 text-sm font-semibold text-fuchsia-100">
              {totalReferrals}
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2 px-5 pb-5 sm:px-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : sortedReferrals.length === 0 ? (
          <div className="border-t border-white/10 px-5 py-10 text-center text-sm text-slate-400">
            У вас пока нет рефералов. Поделитесь ссылкой выше — и доход появится здесь.
          </div>
        ) : (
          <div className="border-t border-white/10">
            {pageItems.map((ref, idx) => {
              const name = ref.name?.trim() || (ref.user_id ? `Реферал #${ref.user_id}` : 'Реферал')
              const dateStr = ref.created
                ? format(parseISO(ref.created.replace(' ', 'T')), 'd MMM yyyy', { locale: ru })
                : null
              return (
                <div
                  key={ref.user_id ?? start + idx}
                  className="flex items-center gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:px-6"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-fuchsia-200">
                    <UserPlusIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{name}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {dateStr ? `Регистрация: ${dateStr}` : 'Дата регистрации неизвестна'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-emerald-300">+{ref.income.toFixed(2)} ₽</div>
                    <div className="mt-0.5 text-xs text-slate-400">оплачено {ref.paid.toFixed(2)} ₽</div>
                  </div>
                </div>
              )
            })}

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-slate-400 sm:px-6">
                <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1">{REFERRALS_PAGE_SIZE}/стр</span>
                <div className="flex items-center gap-3">
                  <span>{start + 1}–{start + pageItems.length} / {sortedReferrals.length}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={pageSafe <= 0}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-40"
                      aria-label="Предыдущая страница"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                      disabled={pageSafe >= pages - 1}
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

            {/* Итог по программе — повторяет блок Telegram-шаблона */}
            <div className="flex flex-col gap-1 border-t border-white/10 bg-white/[0.03] px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <span className="text-slate-300">
                Всего оплачено рефералами: <span className="font-semibold text-white">{totalPaid.toFixed(2)} ₽</span>
              </span>
              <span className="text-slate-300">
                Ваш доход ({commission}%): <span className="font-semibold text-emerald-300">{totalIncome.toFixed(2)} ₽</span>
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Как это работает</h2>
          <div className="mt-6 space-y-5">
            {[
              {
                icon: <ShareIcon className="h-5 w-5" />,
                title: 'Поделитесь ссылкой',
                text: 'Отправьте ссылку другу любым удобным способом.',
              },
              {
                icon: <UserPlusIcon className="h-5 w-5" />,
                title: 'Пользователь регистрируется',
                text: 'Друг проходит регистрацию и становится пользователем.',
              },
              {
                icon: <PercentIcon className="h-5 w-5" />,
                title: `Получайте ${commission}%`,
                text: `Вы получаете ${commission}% с каждого пополнения баланса друга.`,
              },
            ].map((step, index) => (
              <div key={step.title} className="flex items-start gap-4">
                <div className="relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-fuchsia-100">
                  {step.icon}
                  <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-white">
                    {index + 1}
                  </span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{step.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-300">{step.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Условия программы</h2>
          <div className="mt-6 space-y-4">
            {[
              `${commission}% от каждого пополнения баланса реферала`,
              'Начисление происходит автоматически',
              'Бонусы зачисляются на баланс аккаунта',
              'Ограничений по количеству рефералов нет',
            ].map(item => (
              <div key={item} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
                  <CheckIcon className="h-4 w-4" />
                </span>
                <span className="text-sm leading-6 text-slate-200">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="glass flex flex-col gap-3 rounded-[2rem] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-fuchsia-100">
            <InfoIcon className="h-4 w-4" />
          </span>
          <p className="text-sm leading-6 text-slate-300">
            Бонусы можно использовать для оплаты подписки или вывести на баланс.
          </p>
        </div>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-fuchsia-200 hover:text-white sm:self-auto"
        >
          Подробнее <span aria-hidden>→</span>
        </a>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  hint: string
}) {
  return (
    <div className="glass flex items-center gap-4 rounded-[2rem] p-5 sm:p-6">
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-500/20 text-fuchsia-100">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm text-slate-300">{label}</div>
        {value === null ? (
          <div className="mt-1.5 h-7 w-28 animate-pulse rounded-lg bg-white/10" />
        ) : (
          <div className="text-2xl font-bold text-white">{value}</div>
        )}
        <div className="mt-0.5 text-xs text-slate-400">{hint}</div>
      </div>
    </div>
  )
}

function LinkRow({
  icon,
  label,
  value,
  buttonLabel,
  onCopy,
  primary = false,
  disabled = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  buttonLabel: string
  onCopy: () => void
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 rounded-[1.5rem] border border-white/10 bg-white/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-fuchsia-100">
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300">{label}</div>
          <div className="mt-1 break-all text-sm leading-6 text-white">{value}</div>
        </div>
      </div>
      <button
        onClick={onCopy}
        disabled={disabled}
        className={
          primary
            ? 'flex flex-shrink-0 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-brand transition-all hover:brightness-110 disabled:opacity-40'
            : 'flex flex-shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-40'
        }
      >
        <CopyIcon className="h-4 w-4" />
        {buttonLabel}
      </button>
    </div>
  )
}

function WalletIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h3" />
    </svg>
  )
}

function CoinsIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <ellipse cx="9" cy="7" rx="6" ry="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v5c0 1.66 2.69 3 6 3s6-1.34 6-3V7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15v2c0 1.66 2.69 3 6 3s6-1.34 6-3v-5c0-1.66-2.69-3-6-3" />
    </svg>
  )
}

function UsersIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="9" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14c2.5.5 4 2.6 4 5.5" />
    </svg>
  )
}

function LinkIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" />
    </svg>
  )
}

function TelegramIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-11 11" />
    </svg>
  )
}

function CopyIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function ShareIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path strokeLinecap="round" d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
    </svg>
  )
}

function UserPlusIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 20c0-3.3 3.1-6 8-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 14v6M15 17h6" />
    </svg>
  )
}

function PercentIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" d="m6 18 12-12" />
      <circle cx="7.5" cy="7.5" r="1.5" />
      <circle cx="16.5" cy="16.5" r="1.5" />
    </svg>
  )
}

function CheckIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  )
}

function InfoIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 11v5M12 8h.01" />
    </svg>
  )
}
