import clsx from 'clsx'

export function BrandLogo({
  size = 56,
  showWordmark = false,
  className,
}: {
  size?: number
  showWordmark?: boolean
  className?: string
}) {
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <img
        src="/djvpn-brand.jpg"
        alt="DJ VPN"
        width={size}
        height={size}
        className="rounded-2xl object-cover shadow-[0_24px_60px_rgba(230,120,255,0.25)] ring-1 ring-white/10"
      />
      {showWordmark && (
        <div className="min-w-0">
          <div className="text-sm uppercase tracking-[0.35em] text-fuchsia-200/70">DJ VPN</div>
          <div className="text-xs text-slate-300">fast secure reliable</div>
        </div>
      )}
    </div>
  )
}
