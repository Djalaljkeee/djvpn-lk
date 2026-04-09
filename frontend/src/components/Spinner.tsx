export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'w-3 h-3 border', md: 'w-5 h-5 border-2', lg: 'w-8 h-8 border-2' }[size]
  return (
    <div className={`${s} border-brand-400 border-t-transparent rounded-full animate-spin inline-block`} />
  )
}

export function PageLoader() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" />
        <span className="text-sm text-slate-500">Загрузка...</span>
      </div>
    </div>
  )
}

export function SkeletonCard() {
  return <div className="h-24 rounded-xl bg-surface-2 animate-pulse" />
}
