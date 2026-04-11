import { useEffect, useState } from 'react'
import { fetchReferrals } from '../api/user'
import { fetchConfig } from '../api/services'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import type { ReferralStats } from '../types'

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
  const totalReferrals = stats?.total_referrals ?? 0
  const totalIncome = stats?.total_income ?? 0
  const items = stats?.items ?? 0
  const hasDetails = !!stats?.referrals?.length

  const copyLink = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    show(`${label} скопирована`, 'success')
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="brand-panel rounded-[2rem] p-5 sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-sm uppercase tracking-[0.35em] text-fuchsia-100/70">Referral program</div>
            <h1 className="mt-3 text-3xl font-bold text-white sm:text-4xl">Реферальная программа с честной статистикой.</h1>
            <p className="mt-3 text-sm leading-6 text-slate-200 sm:text-base">
              Экран опирается на фактический контракт SHM API: основной KPI — количество приглашенных пользователей, а детальный список показывается только когда backend реально его отдает.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:min-w-[340px] sm:grid-cols-3">
            <StatCard label="Рефералов" value={String(totalReferrals)} />
            <StatCard label="С деталями" value={String(items)} />
            <StatCard label="Доход" value={`${totalIncome.toFixed(2)} ₽`} />
          </div>
        </div>
      </section>

      <section className="glass rounded-[2rem] p-5 sm:p-6">
        <h2 className="text-xl font-semibold text-white">Ваша реферальная ссылка</h2>
        <p className="mt-1 text-sm text-slate-300">
          Оставляем только deeplink для Telegram. Он проще для пользователя и совпадает с основным сценарием входа.
        </p>

        <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-300">Telegram deeplink</div>
          <div className="mt-2 break-all text-sm leading-6 text-white">{tgRefLink || 'Ссылка появится после загрузки профиля и конфигурации бота.'}</div>
          <button
            onClick={() => tgRefLink && copyLink(tgRefLink, 'Telegram ссылка')}
            disabled={!tgRefLink}
            className="mt-4 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-brand disabled:opacity-40"
          >
            Скопировать deeplink
          </button>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Как это работает</h2>
          <div className="mt-5 space-y-4">
            {[
              'Отправьте другу Telegram deeplink.',
              'Друг открывает бота и проходит регистрацию.',
              'Реферальная статистика обновляется по данным SHM.',
            ].map((text, index) => (
              <div key={text} className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <p className="text-sm leading-6 text-slate-200">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass rounded-[2rem] p-5 sm:p-6">
          <h2 className="text-xl font-semibold text-white">Статус данных из API</h2>

          {loading ? (
            <div className="mt-5 space-y-3 animate-pulse">
              <div className="h-20 rounded-2xl bg-white/5" />
              <div className="h-20 rounded-2xl bg-white/5" />
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-semibold text-white">Основная метрика</div>
                <div className="mt-2 text-sm leading-6 text-slate-200">
                  SHM сейчас отдает общее количество рефералов. Поэтому этот экран сначала показывает KPI, а не строит фейковую таблицу.
                </div>
              </div>

              {hasDetails ? (
                <div className="space-y-3">
                  {stats?.referrals?.map((ref, index) => (
                    <div key={`${ref.user_id ?? 'ref'}-${index}`} className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-semibold text-white">{ref.name || ref.login || `Реферал #${index + 1}`}</div>
                      <div className="mt-2 text-sm text-slate-300">
                        {ref.login && <div>Логин: {ref.login}</div>}
                        {ref.created && <div>Дата: {ref.created}</div>}
                        {typeof ref.income === 'number' && <div>Доход: {ref.income.toFixed(2)} ₽</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-white/15 bg-white/5 p-5">
                  <div className="text-sm font-semibold text-white">Детального списка пока нет</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Как только backend начнет отдавать подробные записи, экран сможет показать их здесь без полной переработки UX.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  )
}
