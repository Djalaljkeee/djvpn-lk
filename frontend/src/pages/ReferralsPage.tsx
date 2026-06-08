import { useEffect, useState } from 'react'
import { fetchReferrals } from '../api/user'
import { fetchConfig } from '../api/services'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { ReferralStats } from '../types'

const SUPPORT_URL = 'https://t.me/help_djvpn'

const steps = [
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
    title: 'Получайте 15%',
    text: 'Вы получаете 15% с каждого пополнения баланса друга.',
  },
]

const conditions = [
  '15% от каждого пополнения баланса реферала',
  'Начисление происходит автоматически',
  'Бонусы зачисляются на баланс аккаунта',
  'Ограничений по количеству рефералов нет',
]

export default function ReferralsPage() {
  const { user } = useAuthStore()
  const { show } = useToast()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [botUsername, setBotUsername] = useState('')

  useEffect(() => {
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
    fetchReferrals()
      .then(setStats)
      .catch(() => show('Ошибка загрузки реферальной статистики', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const tgRefLink = user && botUsername ? `https://t.me/${botUsername}?start=${user.user_id}` : ''
  const webRefLink = user && typeof window !== 'undefined'
    ? `${window.location.origin}/?ref=${user.user_id}`
    : ''
  const totalReferrals = stats?.total_referrals ?? 0
  const totalIncome = stats?.total_income ?? 0

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
            Получайте 15% с каждого пополнения приглашённых пользователей.
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
            {totalReferrals > 0 && (
              <> · приглашено: <span className="font-semibold text-white">{totalReferrals}</span></>
            )}
          </p>
        </div>
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

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Как это работает</h2>
          <div className="mt-6 space-y-5">
            {steps.map((step, index) => (
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
            {conditions.map(item => (
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
