import { differenceInDays, parseISO } from 'date-fns'
import type { UserService } from '../../types'
import type { RemnaUserInfo } from '../../types'

function formatTrafficLimit(bytes: number | null): string {
  if (bytes === null) return '-- ГБ'
  if (bytes === 0) return '∞ ГБ'
  return `${(bytes / 1e9).toFixed(1)} ГБ`
}

function isTrial(svc: UserService): boolean {
  const text = ((svc.descr ?? '') + ' ' + (svc.name ?? '')).toLowerCase()
  return text.includes('пробн') || text.includes('trial')
}

interface Props {
  svc: UserService
  remnaInfo: RemnaUserInfo | null
}

export default function PlanCard({ svc, remnaInfo }: Props) {
  const trial = isTrial(svc)
  const expiredAt = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const daysLeft = expiredAt ? differenceInDays(expiredAt, new Date()) : null
  const limitIp = remnaInfo?.hwid_device_limit ?? remnaInfo?.limit_ip ?? null
  const trafficLimit = remnaInfo?.traffic_limit_bytes ?? null

  return (
    <div className="glass rounded-[1.75rem] p-5">
      {/* Badge row */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0" />
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-white">{svc.name}</span>
        </div>
        {trial && (
          <span className="rounded-full border border-brand-400/40 bg-brand-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-200">
            Пробный период
          </span>
        )}
      </div>

      <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-3">Текущий тариф</div>

      {/* Inner card */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20">
            <svg className="h-5 w-5 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">
              {trial ? 'Пробный период' : svc.name}
            </div>
            <div className="mt-1 text-xs leading-5 text-slate-300">
              {trial
                ? 'Вы используете пробную версию сервиса. Выберите тариф ниже для полного доступа.'
                : svc.descr ?? ''}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-4 flex flex-wrap gap-4 text-xs">
          <div>
            <span className="font-bold text-white">
              {daysLeft !== null ? `${daysLeft} ${pluralDays(daysLeft)}` : '--'}
            </span>
            <span className="ml-1 text-slate-400">осталось</span>
          </div>
          <div>
            <span className="font-bold text-white">{formatTrafficLimit(trafficLimit)}</span>
            <span className="ml-1 text-slate-400">Трафик</span>
          </div>
          <div>
            <span className="font-bold text-white">
              {limitIp !== null ? limitIp : '--'}
            </span>
            <span className="ml-1 text-slate-400">Устройства</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function pluralDays(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'день'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'дня'
  return 'дней'
}
