import { useState } from 'react'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { UserService, RemnaUserInfo } from '../../types'
import SetupGuide from '../SetupGuide'
import { resolveDeviceLimit } from '../../utils/deviceLimit'

function formatTraffic(bytes: number | null): string {
  if (bytes === null) return '0 МБ'
  if (bytes < 1e6) return `${bytes} Б`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} МБ`
  return `${(bytes / 1e9).toFixed(1)} ГБ`
}

function daysWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
  return 'дней'
}

interface Props {
  svc: UserService
  remna?: RemnaUserInfo | null
  devicesCount?: number
}

export default function CompactSubscriptionCard({ svc, remna }: Props) {
  const [setupOpen, setSetupOpen] = useState(false)

  const expiredAt = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const createdAt = svc.created ? parseISO(svc.created.replace(' ', 'T')) : null
  const daysLeft = expiredAt ? Math.max(0, differenceInCalendarDays(expiredAt, new Date())) : null
  const totalDays =
    createdAt && expiredAt
      ? Math.max(1, differenceInCalendarDays(expiredAt, createdAt))
      : 30
  const progress = daysLeft !== null ? Math.min(1, Math.max(0, daysLeft / totalDays)) : 0

  const limitIp = resolveDeviceLimit(remna)
  const trafficLimit = remna?.traffic_limit_bytes ?? null
  const trafficLabel = trafficLimit === null || trafficLimit === 0
    ? 'безлимит'
    : formatTraffic(trafficLimit)

  // Circular progress geometry
  const size = 88
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress)

  return (
    <>
      <div className="glass rounded-[1.75rem] p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-100">
            Активна
          </span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">{svc.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              {limitIp} устройств · {trafficLabel}
            </p>
          </div>

          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={stroke}
                fill="none"
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="#dd56ca"
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
              <span className="text-xl font-bold text-white">
                {daysLeft !== null ? daysLeft : '--'}
              </span>
              <span className="mt-0.5 text-[10px] text-slate-400">
                {daysLeft !== null ? daysWord(daysLeft) : 'дней'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setSetupOpen(true)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand hover:brightness-110 transition-all"
        >
          <span className="h-2 w-2 rounded-full bg-white" />
          Подключиться
        </button>
      </div>

      {setupOpen && (
        <SetupGuide
          subUrl={svc.subscription_url}
          serviceId={svc.subscription_url ? undefined : svc.id}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </>
  )
}
