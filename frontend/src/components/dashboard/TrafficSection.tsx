interface Props {
  usedBytes: number | null
  limitBytes: number | null
  onRefresh: () => void
  refreshing: boolean
}

function formatUsed(bytes: number | null): string {
  if (bytes === null) return '0 MB'
  if (bytes < 1e6) return `${bytes} B`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${(bytes / 1e9).toFixed(2)} ГБ`
}

export default function TrafficSection({ usedBytes, limitBytes, onRefresh, refreshing }: Props) {
  const isUnlimited = limitBytes === 0 || limitBytes === null
  const pct = (!isUnlimited && limitBytes && usedBytes)
    ? Math.min((usedBytes / limitBytes) * 100, 100)
    : 0

  return (
    <div className="glass rounded-[1.75rem] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Трафик</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{formatUsed(usedBytes)}</span>
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Обновить
          </button>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500"
          style={{ width: isUnlimited ? '8%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}
