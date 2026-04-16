interface Props {
  connectedCount: number
  limitIp: number | null
}

export default function DeviceConnectionCard({ connectedCount, limitIp }: Props) {
  const total = limitIp ?? 3
  const dots = Math.max(total, 1)

  return (
    <div className="glass rounded-[1.75rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/8">
            <svg className="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path strokeLinecap="round" d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Подключить устройство</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {connectedCount} из {limitIp ?? '?'} подключено
            </div>
          </div>
        </div>
        {/* Dot indicators */}
        <div className="flex shrink-0 items-center gap-1.5">
          {Array.from({ length: dots }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                i < connectedCount ? 'bg-brand-400' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
