import { useEffect, useState } from 'react'
import { fetchStatus } from '../../api/user'
import type { StatusData, StatusMonitor } from '../../types'

/** Determine quality label & color from uptime percentage */
function getQuality(uptime: number | null): { label: string; color: string; bars: number } {
  if (uptime === null) return { label: 'Unknown', color: 'text-slate-400', bars: 0 }
  if (uptime >= 99.9) return { label: 'Excellent', color: 'text-emerald-400', bars: 4 }
  if (uptime >= 99.0) return { label: 'Great', color: 'text-green-400', bars: 3 }
  if (uptime >= 95.0) return { label: 'Fair', color: 'text-yellow-400', bars: 2 }
  return { label: 'Poor', color: 'text-red-400', bars: 1 }
}

/** Country code flags mapping — extract 2-letter code if monitor name starts with it */
function parseMonitorName(name: string): { code: string | null; displayName: string } {
  const match = name.match(/^([A-Z]{2})\s+(.+)$/)
  if (match) return { code: match[1], displayName: name }
  return { code: null, displayName: name }
}

function SignalBars({ filled, className }: { filled: number; className?: string }) {
  return (
    <svg className={className} width="20" height="16" viewBox="0 0 20 16" fill="none">
      {[0, 1, 2, 3].map(i => (
        <rect
          key={i}
          x={i * 5}
          y={12 - i * 4}
          width="3.5"
          height={4 + i * 4}
          rx="0.75"
          fill={i < filled ? '#4ade80' : 'rgba(255,255,255,0.15)'}
        />
      ))}
    </svg>
  )
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {online && (
        <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
    </span>
  )
}

function MonitorIcon({ code }: { code: string | null }) {
  if (code) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white/80 border border-white/5">
        {code}
      </div>
    )
  }
  // Generic service icon (globe)
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 border border-white/5">
      <svg className="h-5 w-5 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    </div>
  )
}

function StatusCard({ monitor }: { monitor: StatusMonitor }) {
  const { code, displayName } = parseMonitorName(monitor.name)
  const uptime = monitor.uptime_24
  const quality = getQuality(uptime)
  const online = monitor.status === 1

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[rgba(20,12,30,0.85)] p-4 transition-colors hover:border-white/[0.12]">
      {/* Top row: icon + name + online dot + signal */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <MonitorIcon code={code} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {code && (
                <span className="inline-flex h-5 items-center rounded bg-white/10 px-1.5 text-[10px] font-bold text-white/70 tracking-wide">
                  {code}
                </span>
              )}
              <span className="truncate text-sm font-semibold text-white">{displayName}</span>
            </div>
            <div className={`text-xs font-medium mt-0.5 ${quality.color}`}>{quality.label}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <OnlineDot online={online} />
          <SignalBars filled={quality.bars} />
        </div>
      </div>

      {/* Bottom row: uptime badge + ping */}
      <div className="mt-3 flex items-center justify-between">
        {uptime !== null ? (
          <span className="inline-flex items-center rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/20">
            {uptime}% uptime
          </span>
        ) : (
          <span className="inline-flex items-center rounded-lg bg-white/5 px-2.5 py-1 text-xs text-slate-400">
            --
          </span>
        )}
        <span className="text-xs text-slate-400 tabular-nums">
          {monitor.ping > 0 ? `${monitor.ping}ms` : '--'}
        </span>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[rgba(20,12,30,0.85)] p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-white/10 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
          <div className="h-3 w-16 rounded bg-white/10 animate-pulse" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="h-6 w-24 rounded-lg bg-white/10 animate-pulse" />
        <div className="h-3 w-10 rounded bg-white/10 animate-pulse" />
      </div>
    </div>
  )
}

export default function ServerStatus() {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchStatus()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  if (error && !data) {
    return (
      <section className="animate-slide-up">
        <h2 className="text-xl font-semibold text-white mb-4">Статус серверов</h2>
        <div className="glass rounded-[2rem] p-10 text-center">
          <div className="flex items-center justify-center mb-3">
            <svg className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
          <p className="text-sm text-slate-300">Не удалось загрузить статус серверов</p>
        </div>
      </section>
    )
  }

  const allMonitors = data?.groups.flatMap(g => g.monitors) ?? []

  return (
    <section className="space-y-4 animate-slide-up">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">Статус серверов</h2>
        {data?.status_url && (
          <a
            href={data.status_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors"
          >
            Открыть полностью
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : allMonitors.map(m => <StatusCard key={m.id} monitor={m} />)
        }
      </div>
    </section>
  )
}
