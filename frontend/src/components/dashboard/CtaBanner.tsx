import { Link } from 'react-router-dom'

interface Props {
  onClick?: () => void
  open?: boolean
}

export default function CtaBanner({ onClick, open }: Props) {
  const content = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/25">
        <span className="text-brand-300 text-lg">✦</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white">
          {open ? 'Скрыть каталог тарифов' : 'Выберите тариф для продолжения'}
        </div>
        <div className="mt-0.5 text-xs text-slate-400">Больше трафика и устройств</div>
      </div>
      <svg
        className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </>
  )

  const className =
    'flex w-full items-center gap-4 rounded-[1.75rem] border border-brand-500/30 bg-gradient-to-r from-brand-900/60 to-surface-2/80 p-5 text-left transition-all hover:brightness-110 hover:border-brand-400/50'

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    )
  }

  return (
    <Link to="/services" className={className}>
      {content}
    </Link>
  )
}
