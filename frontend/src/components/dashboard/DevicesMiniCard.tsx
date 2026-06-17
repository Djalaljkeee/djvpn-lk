interface Props {
  used: number
  limit: number
}

export default function DevicesMiniCard({ used, limit }: Props) {
  const safeLimit = Math.max(1, limit)
  const overLimit = used > safeLimit
  const segments = Array.from({ length: safeLimit }, (_, i) => i < used)

  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
        Устройства
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={`text-2xl font-bold leading-none ${overLimit ? 'text-rose-400' : 'text-white'}`}>
          {used}
        </span>
        <span className="text-sm font-medium text-slate-400">/ {safeLimit}</span>
      </div>
      <div className="mt-3 flex gap-1">
        {segments.map((filled, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              filled ? 'bg-gradient-to-r from-brand-500 to-brand-400' : 'bg-white/10'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
