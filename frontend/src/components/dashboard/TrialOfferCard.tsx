interface Props {
  onActivate: () => void
  loading: boolean
}

export default function TrialOfferCard({ onActivate, loading }: Props) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-brand-500/30 bg-gradient-to-br from-brand-900/60 to-surface-2/80 p-5">
      <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-brand-500/10 blur-2xl" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20">
            <span className="text-brand-300 text-lg">✦</span>
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Попробуйте DJ VPN бесплатно</div>
            <div className="text-xs text-slate-400">7 дней бесплатного доступа</div>
          </div>
        </div>

        <p className="text-xs leading-5 text-slate-300 mb-4">
          Активируйте пробный период и оцените скорость и стабильность VPN без оплаты.
        </p>

        <button
          onClick={onActivate}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3 text-sm font-semibold text-white shadow-brand hover:brightness-110 transition-all disabled:opacity-50"
        >
          {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          {loading ? 'Активируем…' : 'Активировать пробный период'}
        </button>
      </div>
    </div>
  )
}
