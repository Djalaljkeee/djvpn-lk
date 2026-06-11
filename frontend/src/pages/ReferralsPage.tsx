import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { fetchReferrals } from '../api/user'
import { fetchConfig } from '../api/services'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { ReferralStats } from '../types'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'

const REFERRALS_PAGE_SIZE = 25

// Реферальные уровни. Уровень зависит от количества АКТИВНЫХ рефералов
// (те, у кого есть хотя бы один платёж). Пока ladder живёт на фронте —
// заказчик переориентирует на серверную логику, когда заведёт поля
// level/next_level в SHM-шаблоне. Порядок: от младшего к старшему,
// последний элемент — потолок (next нет).
type Level = { name: string; threshold: number; commission: number }
const LEVELS: Level[] = [
  { name: 'Новичок',    threshold: 0,   commission: 15 },
  { name: 'Старт',      threshold: 10,  commission: 17 },
  { name: 'Эксперт',    threshold: 25,  commission: 20 },
  { name: 'Партнер',    threshold: 50,  commission: 22 },
  { name: 'Амбассадор', threshold: 100, commission: 25 },
]

// Текстовый диапазон активных рефералов для карточки уровня: «50 – 99»
// или «100+» для последнего.
function levelRange(idx: number): string {
  const lo = LEVELS[idx].threshold
  const next = LEVELS[idx + 1]
  return next ? `${lo} – ${next.threshold - 1}` : `${lo}+`
}

function computeLevel(activeReferrals: number) {
  // Бежим от старшего к младшему — первый подходящий по порогу = текущий.
  let currentIdx = 0
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (activeReferrals >= LEVELS[i].threshold) { currentIdx = i; break }
  }
  const current = LEVELS[currentIdx]
  const next = LEVELS[currentIdx + 1] ?? null
  return {
    current,
    currentIdx,
    next,
    progressTo: next ? Math.min(1, activeReferrals / next.threshold) : 1,
    needForNext: next ? Math.max(0, next.threshold - activeReferrals) : 0,
  }
}

export default function ReferralsPage() {
  const { user } = useAuthStore()
  const { show } = useToast()
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [botUsername, setBotUsername] = useState('')
  const [page, setPage] = useState(0)
  const [qrOpen, setQrOpen] = useState(false)

  useEffect(() => {
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user) return
    setLoading(true)
    fetchReferrals()
      .then(setStats)
      .catch(() => show('Ошибка загрузки реферальной статистики', 'error'))
      .finally(() => setLoading(false))
  }, [user?.user_id])

  // Короткая ссылка (макет: lk.djvpn.ru/r/ref-2). Резолвится через
  // <Route path="/r/:id"> в App.tsx → захват + редирект на /.
  const webRefLink = user && typeof window !== 'undefined'
    ? `${window.location.origin}/r/ref-${user.user_id}`
    : ''
  const tgRefLink = user && botUsername ? `https://t.me/${botUsername}?start=${user.user_id}` : ''

  const totalReferrals = stats?.total_referrals ?? 0
  const activeReferrals = stats?.active_referrals ?? 0
  const totalIncome = stats?.total_income ?? 0
  const totalPaid = stats?.total_paid ?? 0
  const activeRefs30 = stats?.active_referrals_30d ?? 0
  const paid30 = stats?.paid_30d
  const income30 = stats?.income_30d

  // Уровень и комиссия считаются от числа АКТИВНЫХ рефералов (paid > 0).
  const level = computeLevel(activeReferrals)
  const commission = level.current.commission

  // Сортируем по доходу убыв., вторичный ключ — user_id desc (стабильно
  // для рефералов с нулевым income).
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
    if (!text) return
    navigator.clipboard.writeText(text)
    show(`${label} скопирована`, 'success')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero + блок уровня */}
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="brand-panel relative overflow-hidden rounded-[2rem] p-6 sm:p-8">
          <div className="relative z-10 max-w-md">
            <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
              Реферальная<br />
              <span className="gradient-text">программа</span>
            </h1>
            <p className="mt-4 text-base font-medium leading-7 text-white">
              Получайте <span className="text-fuchsia-300">{commission}%</span> с каждого пополнения
              приглашённых пользователей.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Чем больше активных друзей — тем выше ваш доход.
            </p>
          </div>
          <GiftIllustration className="pointer-events-none absolute -right-4 bottom-0 hidden h-44 w-44 opacity-90 sm:block" />
        </div>

        <LevelCard level={level} activeReferrals={activeReferrals} loading={loading} />
      </section>

      {/* Как растёт ваш процент — лестница уровней по активным рефералам */}
      <LevelLadder currentIdx={level.currentIdx} loading={loading} />

      {/* Три метрики */}
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          icon={<WalletIcon className="h-5 w-5" />}
          tone="emerald"
          label="Заработано"
          value={loading ? null : `${formatMoney(totalIncome)} ₽`}
          delta={income30 != null ? { value: income30, kind: 'money' } : null}
        />
        <MetricCard
          icon={<UsersIcon className="h-5 w-5" />}
          tone="brand"
          label="Активных рефералов"
          value={loading ? null : String(activeReferrals)}
          delta={loading ? null : { value: activeRefs30, kind: 'count' }}
        />
        <MetricCard
          icon={<CoinsIcon className="h-5 w-5" />}
          tone="amber"
          label="Оборот рефералов"
          value={loading ? null : `${formatMoney(totalPaid)} ₽`}
          delta={paid30 != null ? { value: paid30, kind: 'money' } : null}
        />
      </section>

      {/* Реферальная ссылка + кнопки */}
      <section className="glass rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-white">Ваша реферальная ссылка</h2>
          <p className="text-sm text-slate-400">Делитесь ссылкой и приглашайте друзей</p>
        </div>
        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="min-w-0 flex-1 truncate text-sm text-white">
              {webRefLink || 'Ссылка появится после загрузки профиля'}
            </div>
            <button
              onClick={() => copyLink(webRefLink, 'Ссылка')}
              disabled={!webRefLink}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-slate-200 transition-colors hover:bg-white/20 disabled:opacity-40"
              aria-label="Скопировать ссылку"
            >
              <CopyIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:flex lg:shrink-0">
            <ActionButton
              variant="primary"
              icon={<CopyIcon className="h-4 w-4" />}
              label="Скопировать ссылку"
              disabled={!webRefLink}
              onClick={() => copyLink(webRefLink, 'Ссылка')}
            />
            <ActionButton
              variant="telegram"
              icon={<TelegramIcon className="h-4 w-4" />}
              label="Telegram DeepLink"
              disabled={!tgRefLink}
              onClick={() => copyLink(tgRefLink, 'Telegram-ссылка')}
            />
            <ActionButton
              variant="ghost"
              icon={<QrIcon className="h-4 w-4" />}
              label="QR-код"
              disabled={!webRefLink}
              onClick={() => setQrOpen(true)}
            />
          </div>
        </div>
      </section>

      {/* Три буллета */}
      <section className="grid gap-4 sm:grid-cols-3">
        <FeatureCard
          tone="emerald"
          icon={<ShieldIcon className="h-5 w-5" />}
          title="Стабильный доход"
          text={`Получайте ${commission}% с каждого платежа ваших друзей`}
        />
        <FeatureCard
          tone="brand"
          icon={<BoltIcon className="h-5 w-5" />}
          title="Быстрые выплаты"
          text="Средства начисляются автоматически"
        />
        <FeatureCard
          tone="cyan"
          icon={<ShieldIcon className="h-5 w-5" />}
          title="Без ограничений"
          text="Приглашайте сколько угодно пользователей"
        />
      </section>

      {/* Таблица рефералов */}
      <section className="glass rounded-[2rem] overflow-hidden">
        <div className="flex flex-col gap-1 px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-white">Ваши рефералы</h2>
            {!loading && totalReferrals > 0 && (
              <span className="rounded-full bg-white/10 px-3 py-0.5 text-sm font-semibold text-slate-200">
                {totalReferrals}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            Список пользователей, зарегистрированных по вашей ссылке
          </p>
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
            {/* Шапка таблицы — только на десктопе */}
            <div className="hidden grid-cols-[1fr_auto_auto] gap-6 border-b border-white/10 px-5 py-3 text-xs uppercase tracking-wider text-slate-400 sm:grid sm:px-6">
              <span>Пользователь</span>
              <span className="text-right">Дата регистрации</span>
              <span className="text-right">Ваш бонус</span>
            </div>

            {pageItems.map((ref, idx) => {
              const name = ref.name?.trim() || (ref.user_id ? `Реферал #${ref.user_id}` : 'Реферал')
              const dateStr = ref.created
                ? format(parseISO(ref.created.replace(' ', 'T')), 'd MMM yyyy', { locale: ru })
                : null
              const showLogin = ref.login && ref.login !== name
              // Активный реферал — тот, у кого есть хотя бы один платёж.
              const isActive = ref.paid > 0
              return (
                <div
                  key={ref.user_id ?? start + idx}
                  className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/5 px-5 py-3 last:border-0 sm:grid-cols-[1fr_auto_auto] sm:gap-6 sm:px-6"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-slate-300">
                      <UserIcon className="h-5 w-5" />
                      {isActive && (
                        <span
                          className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-surface-1 bg-emerald-400"
                          title="Активный реферал (есть платёж)"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">{name}</span>
                        {isActive && (
                          <span className="hidden shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 sm:inline">
                            активен
                          </span>
                        )}
                      </div>
                      {showLogin && (
                        <div className="mt-0.5 truncate text-xs text-slate-400">{ref.login}</div>
                      )}
                    </div>
                  </div>
                  <div className="hidden self-center text-right text-sm text-slate-300 sm:block">
                    {dateStr ?? '—'}
                  </div>
                  <div className="self-center text-right">
                    <div className="text-sm font-semibold text-emerald-300">+{formatMoney(ref.income)} ₽</div>
                    {dateStr && (
                      <div className="mt-0.5 text-xs text-slate-500 sm:hidden">{dateStr}</div>
                    )}
                  </div>
                </div>
              )
            })}

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-xs text-slate-400 sm:px-6">
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
          </div>
        )}
      </section>

      {qrOpen && webRefLink && (
        <QrModal url={webRefLink} onClose={() => setQrOpen(false)} />
      )}
    </div>
  )
}

// ────── Подкомпоненты ──────

function LevelCard({
  level,
  activeReferrals,
  loading,
}: {
  level: ReturnType<typeof computeLevel>
  activeReferrals: number
  loading: boolean
}) {
  const { current, next, progressTo, needForNext } = level
  return (
    <div className="glass flex flex-col gap-5 rounded-[2rem] p-6 sm:p-7">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
          <StarIcon className="h-5 w-5" />
        </div>
        <div className="text-base font-medium text-white">
          Ваш уровень: <span className="font-semibold">{current.name}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-400 transition-all duration-500"
            style={{ width: `${Math.round(progressTo * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-end text-xs text-slate-400">
          <span>
            {loading ? '…' : activeReferrals}{next ? ` / ${next.threshold}` : ''}
          </span>
        </div>
      </div>

      {next ? (
        <>
          <div className="flex items-start gap-3 text-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/5 text-slate-300">
              <RefreshIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-slate-300">До следующего уровня</div>
              <div className="text-white">
                ещё <span className="font-semibold">{needForNext}</span> активных рефералов
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 text-sm">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
              <TrendUpIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-slate-300">Следующий уровень: <span className="text-emerald-300 font-semibold">{next.commission}%</span></div>
              <div className="text-emerald-300 font-semibold">
                +{next.commission - current.commission}% <span className="text-slate-400 font-normal">к текущей ставке</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3 text-sm">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
            <StarIcon className="h-4 w-4" />
          </div>
          <div className="text-slate-300">
            Вы достигли максимального уровня — <span className="text-white font-semibold">{current.commission}%</span> с каждого пополнения.
          </div>
        </div>
      )}
    </div>
  )
}

// «Как растёт ваш процент» — наглядная лестница уровней. Текущий уровень
// (по числу активных рефералов) подсвечивается и помечается бейджем.
function LevelLadder({ currentIdx, loading }: { currentIdx: number; loading: boolean }) {
  return (
    <section className="glass rounded-[2rem] p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold text-white">Как растёт ваш процент</h2>
        <p className="text-sm text-slate-400">
          Процент начисляется с каждого пополнения ваших активных рефералов
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {LEVELS.map((lvl, idx) => {
          const isCurrent = !loading && idx === currentIdx
          return (
            <div
              key={lvl.name}
              className={`relative flex flex-col items-center rounded-2xl border px-3 py-4 text-center transition-colors ${
                isCurrent
                  ? 'border-brand-400/60 bg-brand-500/10 shadow-brand'
                  : 'border-white/10 bg-white/5'
              }`}
            >
              {isCurrent && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gradient-to-r from-brand-500 to-fuchsia-500 px-2.5 py-0.5 text-[10px] font-semibold text-white shadow">
                  Ваш текущий уровень
                </span>
              )}
              <div className={`text-base font-semibold ${isCurrent ? 'text-white' : 'text-slate-200'}`}>
                {levelRange(idx)}
              </div>
              <div className="mt-0.5 text-[11px] leading-tight text-slate-400">
                активных рефералов
              </div>
              <div className={`mt-3 text-2xl font-bold ${isCurrent ? 'gradient-text' : 'text-slate-300'}`}>
                {lvl.commission}%
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-slate-400">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          Уровень зависит от количества активных рефералов и обновляется автоматически.
          Активный реферал — тот, у кого есть хотя бы один платёж.
        </span>
      </div>
    </section>
  )
}

function MetricCard({
  icon, tone, label, value, delta,
}: {
  icon: React.ReactNode
  tone: 'emerald' | 'brand' | 'amber'
  label: string
  value: string | null
  delta: { value: number; kind: 'money' | 'count' } | null
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300',
    brand:   'bg-brand-500/20  text-fuchsia-200',
    amber:   'bg-amber-500/15  text-amber-300',
  }
  const deltaToneClasses: Record<typeof tone, string> = {
    emerald: 'text-emerald-300',
    brand:   'text-fuchsia-300',
    amber:   'text-amber-300',
  }
  return (
    <div className="glass rounded-[2rem] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${toneClasses[tone]}`}>
          {icon}
        </div>
        <span className="text-sm text-slate-300">{label}</span>
      </div>
      <div className="mt-3">
        {value === null ? (
          <div className="h-9 w-32 animate-pulse rounded-lg bg-white/10" />
        ) : (
          <div className="text-3xl font-bold text-white sm:text-4xl">{value}</div>
        )}
      </div>
      {delta && (
        <div className={`mt-2 text-sm font-medium ${deltaToneClasses[tone]}`}>
          {delta.kind === 'money' ? `+${formatMoney(delta.value)} ₽` : `+${delta.value}`} за последние 30 дней
        </div>
      )}
    </div>
  )
}

function FeatureCard({
  tone, icon, title, text,
}: {
  tone: 'emerald' | 'brand' | 'cyan'
  icon: React.ReactNode
  title: string
  text: string
}) {
  const toneClasses: Record<typeof tone, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300',
    brand:   'bg-brand-500/20  text-fuchsia-200',
    cyan:    'bg-cyan-500/15   text-cyan-300',
  }
  return (
    <div className="glass flex items-start gap-3 rounded-[2rem] p-5 sm:p-6">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${toneClasses[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <p className="mt-1 text-sm leading-6 text-slate-300">{text}</p>
      </div>
    </div>
  )
}

function ActionButton({
  variant, icon, label, onClick, disabled,
}: {
  variant: 'primary' | 'telegram' | 'ghost'
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const cls: Record<typeof variant, string> = {
    primary:  'bg-gradient-to-r from-brand-500 to-brand-700 text-white shadow-brand hover:brightness-110',
    telegram: 'bg-gradient-to-r from-sky-500 to-blue-600 text-white hover:brightness-110',
    ghost:    'border border-white/15 bg-white/5 text-white hover:bg-white/10',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center gap-1 rounded-2xl px-3 py-3 text-[11px] font-semibold leading-tight transition-all disabled:opacity-40 sm:flex-row sm:gap-2 sm:px-4 sm:text-xs ${cls[variant]}`}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/15 sm:h-5 sm:w-5 sm:bg-transparent">
        {icon}
      </span>
      <span className="text-center sm:text-left">{label}</span>
    </button>
  )
}

function QrModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  useEffect(() => {
    QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      color: { dark: '#0f0a18', light: '#ffffff' },
    })
      .then(setDataUrl)
      .catch(() => setDataUrl(''))
  }, [url])

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-[2rem] bg-surface-1 p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-slate-300 hover:bg-white/10"
          aria-label="Закрыть"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <h3 className="text-lg font-semibold text-white">QR-код вашей ссылки</h3>
        <p className="mt-1 text-sm text-slate-400">Покажите код другу — он сразу попадёт на регистрацию.</p>
        <div className="mt-5 flex items-center justify-center rounded-2xl bg-white p-4">
          {dataUrl ? (
            <img src={dataUrl} alt="QR-код реферальной ссылки" className="h-64 w-64" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center text-slate-400 text-sm">Генерация…</div>
          )}
        </div>
        <div className="mt-4 break-all rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-center text-xs text-slate-300">
          {url}
        </div>
      </div>
    </div>
  )
}

// ────── Утилиты ──────

// Форматирование с пробелами-разделителями тысяч: «5 460.98».
function formatMoney(n: number): string {
  const fixed = n.toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + decPart
}

// ────── SVG-иконки ──────

function WalletIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 12h3" />
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

function CoinsIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <ellipse cx="9" cy="7" rx="6" ry="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v5c0 1.66 2.69 3 6 3s6-1.34 6-3V7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15v2c0 1.66 2.69 3 6 3s6-1.34 6-3v-5c0-1.66-2.69-3-6-3" />
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

function TelegramIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m22 2-11 11" />
    </svg>
  )
}

function QrIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path strokeLinecap="round" d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20h1" />
    </svg>
  )
}

function StarIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l2.9 6.7L22 9.6l-5.3 4.7L18.2 22 12 18.4 5.8 22l1.5-7.7L2 9.6l7.1-.9L12 2z" />
    </svg>
  )
}

function RefreshIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 8a8 8 0 0 0-14.93-1M4 16a8 8 0 0 0 14.93 1" />
    </svg>
  )
}

function TrendUpIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 17l6-6 4 4 8-8" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 7h7v7" />
    </svg>
  )
}

function ShieldIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
    </svg>
  )
}

function BoltIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  )
}

function UserIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="8" r="4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

function InfoIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 11v5M12 8h.01" />
    </svg>
  )
}

function GiftIllustration({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none">
      <defs>
        <linearGradient id="g-box" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a855f7" />
          <stop offset="1" stopColor="#6b21a8" />
        </linearGradient>
        <linearGradient id="g-ribbon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#c026d3" />
        </linearGradient>
        <linearGradient id="g-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset="1" stopColor="#9333ea" />
        </linearGradient>
      </defs>
      {/* Подарок */}
      <rect x="50" y="80" width="100" height="80" rx="8" fill="url(#g-box)" />
      <rect x="50" y="80" width="100" height="14" fill="url(#g-ribbon)" opacity="0.85" />
      <rect x="94" y="80" width="14" height="80" fill="url(#g-ribbon)" opacity="0.85" />
      <path d="M100 80c-12-22-40-14-40 4 0 12 20 16 40 4z" fill="url(#g-ribbon)" />
      <path d="M100 80c12-22 40-14 40 4 0 12-20 16-40 4z" fill="url(#g-ribbon)" />
      {/* Монеты */}
      <circle cx="155" cy="140" r="16" fill="url(#g-coin)" />
      <text x="155" y="145" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700">₽</text>
      <circle cx="170" cy="120" r="11" fill="url(#g-coin)" opacity="0.85" />
      <text x="170" y="124" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="700">₽</text>
      <circle cx="40" cy="155" r="9" fill="url(#g-coin)" opacity="0.75" />
      {/* Звёздочки */}
      <circle cx="30" cy="55" r="2" fill="#f0abfc" />
      <circle cx="170" cy="40" r="2.5" fill="#fff" opacity="0.7" />
      <circle cx="60" cy="35" r="1.5" fill="#fff" opacity="0.5" />
    </svg>
  )
}
