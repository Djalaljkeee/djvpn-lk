import { Link } from 'react-router-dom'

import type { CartPayload } from '../api/cart'

interface Props {
  payload: CartPayload
  onDismiss: () => void
}

export default function CartBanner({ payload, onDismiss }: Props) {
  const amount = payload.amount_needed ?? 0
  const needsTopup = amount > 0

  return (
    <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-amber-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Незавершённая покупка</div>
          <div className="mt-1 text-sm opacity-90">
            {payload.service_name ? `Тариф «${payload.service_name}»` : 'Выбранный тариф'}
            {needsTopup && (
              <>
                {' · нужно пополнить '}
                <b className="font-mono">{amount.toFixed(2)} ₽</b>
              </>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-lg px-2 py-1 text-xs text-amber-100/70 hover:bg-amber-500/10"
          aria-label="Скрыть"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/payments"
          className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300"
        >
          Пополнить баланс
        </Link>
        <Link
          to="/services"
          className="rounded-xl border border-amber-400/30 px-4 py-2 text-sm text-amber-100 hover:bg-amber-500/10"
        >
          К подпискам
        </Link>
      </div>
    </div>
  )
}
