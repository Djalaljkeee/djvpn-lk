import { useEffect, useState } from 'react'
import { fetchStatus } from '../../api/user'
import type { StatusData, StatusMonitor } from '../../types'

function getQuality(uptime: number | null): { label: string; color: string; bars: number } {
  if (uptime === null) return { label: 'Unknown', color: 'text-slate-400', bars: 0 }
  if (uptime >= 99.9) return { label: 'Excellent', color: 'text-emerald-400', bars: 4 }
  if (uptime >= 99.0) return { label: 'Great', color: 'text-green-400', bars: 3 }
  if (uptime >= 95.0) return { label: 'Fair', color: 'text-yellow-400', bars: 2 }
  return { label: 'Poor', color: 'text-red-400', bars: 1 }
}

function parseMonitorName(name: string): { code: string | null; displayName: string } {
  const match = name.match(/^([A-Z]{2})\s+(.+)$/)
  if (match) return { code: match[1], displayName: name }
  return { code: null, displayName: name }
}

function SignalBars({ filled }: { filled: number }) {
  return (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
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
    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
      {online && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-40" />}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400' : 'bg-red-400'}`} />
    </span>
  )
}

function MonitorIcon({ code }: { code: string | null }) {
  if (code) {
    return (
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xs font-bold text-white/80 border border-white/5">
        {code}
      </div>
    )
  }
  return (
    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 border border-white/5">
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

function ServerIcon() {
  return (
    <svg className="h-5 w-5 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
    </svg>
  )
}

export default function ServerStatus() {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetchStatus()
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  const allMonitors = data?.groups.flatMap(g => g.monitors) ?? []
  const onlineCount = allMonitors.filter(m => m.status === 1).length
  const totalCount = allMonitors.length
  const allOk = !loading && !error && totalCount > 0 && onlineCount === totalCount
  const hasIssues = !loading && !error && totalCount > 0 && onlineCount < totalCount

  return (
    <section className="animate-slide-up">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full glass rounded-[1.5rem] px-4 py-3.5 flex items-center gap-3 hover:border-white/20 transition-all"
      >
        {/* Icon */}
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-500/20 border border-brand-500/20">
          <ServerIcon />
        </div>

        {/* Title + badge */}
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-semibold text-white">Статус серверов</div>
          <div className="mt-0.5">
            {loading ? (
              <div className="h-4 w-32 rounded bg-white/10 animate-pulse" />
            ) : error ? (
              <span className="text-xs text-red-300 font-medium">Недоступно</span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase ${
                allOk
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : hasIssues
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                    : 'bg-white/10 text-slate-300 border border-white/10'
              }`}>
                {allOk ? 'Все системы работают' : hasIssues ? 'Есть проблемы' : 'Загрузка...'}
                {totalCount > 0 && (
                  <span className="opacity-70">({onlineCount}/{totalCount})</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${open ? 'max-h-[2000px] opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : allMonitors.map(m => <StatusCard key={m.id} monitor={m} />)
          }
        </div>

        {data?.status_url && (
          <div className="mt-3 flex justify-end">
            <a
              href={data.status_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="rounded-2xl bg-white/5 px-4 py-2 text-xs text-slate-300 hover:bg-white/10 transition-colors"
            >
              Открыть полностью ↗
            </a>
          </div>
        )}
      </div>
    </section>
  )
}
