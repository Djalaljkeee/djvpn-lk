interface Props {
  locations: string[]
}

export default function LocationsSection({ locations }: Props) {
  return (
    <div className="glass rounded-[1.75rem] p-5">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-3">Локации</div>
      {locations.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {locations.map(loc => (
            <span
              key={loc}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-white"
            >
              {loc}
            </span>
          ))}
        </div>
      ) : (
        <span className="text-sm text-slate-500">—</span>
      )}
    </div>
  )
}
