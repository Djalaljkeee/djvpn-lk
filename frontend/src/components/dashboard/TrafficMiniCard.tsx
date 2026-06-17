interface Props {
  usedBytes: number | null
  limitBytes: number | null
}

function formatTraffic(bytes: number | null): string {
  if (bytes === null) return '0 МБ'
  if (bytes < 1e6) return `${bytes} Б`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} МБ`
  return `${(bytes / 1e9).toFixed(1)} ГБ`
}

function splitValue(label: string): { value: string; unit: string } {
  const m = label.match(/^([\d.,]+)\s*(.*)$/)
  return m ? { value: m[1], unit: m[2] } : { value: label, unit: '' }
}

export default function TrafficMiniCard({ usedBytes, limitBytes }: Props) {
  const isUnlimited = limitBytes === null || limitBytes === 0
  const pct = (!isUnlimited && limitBytes && usedBytes)
    ? Math.min(100, (usedBytes / limitBytes) * 100)
    : 0
  const { value, unit } = splitValue(formatTraffic(usedBytes ?? 0))

  return (
    <div className="glass rounded-2xl p-4">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
        Трафик
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-white leading-none">{value}</span>
        {unit && <span className="text-sm font-medium text-slate-400">{unit}</span>}
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-500"
          style={{ width: isUnlimited ? '100%' : `${pct}%` }}
        />
      </div>
    </div>
  )
}
