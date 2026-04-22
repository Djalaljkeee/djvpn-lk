import { differenceInDays, parseISO } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import type { UserService, RemnaUserInfo } from '../../types'

function formatTraffic(bytes: number | null): string {
  if (bytes === null) return '0 MB'
  if (bytes < 1e6) return `${bytes} B`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(1)} ГБ`
}

interface Props {
  svc: UserService
  remna?: RemnaUserInfo | null
  devicesCount?: number
}

export default function CompactSubscriptionCard({ svc, remna, devicesCount = 0 }: Props) {
  const navigate = useNavigate()
  const expiredAt = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const daysLeft = expiredAt ? Math.max(0, differenceInDays(expiredAt, new Date())) : null
  const limitIp = remna?.hwid_device_limit ?? remna?.limit_ip ?? 5
  const overLimit = devicesCount > limitIp

  return (
    <div className="glass rounded-[1.75rem] p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-sm font-semibold text-white truncate">{svc.name}</span>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-100 shrink-0">
          Активна
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-xl border border-white/8 bg-white/5 p-3 text-center">
          <div className="text-lg font-bold text-white">
            {daysLeft !== null ? daysLeft : '--'}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">дн.</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/5 p-3 text-center">
          <div className="text-lg font-bold text-white">
            {formatTraffic(remna?.used_traffic_bytes ?? null)}
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">трафик</div>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/5 p-3 text-center">
          <div className="text-lg font-bold text-white">
            <span className={overLimit ? 'text-rose-400' : ''}>{devicesCount}</span>
            <span className="text-slate-400">/{limitIp}</span>
          </div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-400 mt-0.5">устр.</div>
        </div>
      </div>

      <button
        onClick={() => navigate('/services')}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-brand hover:brightness-110 transition-all"
      >
        Управление
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  )
}
