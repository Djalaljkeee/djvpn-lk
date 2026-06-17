import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { useDashboardSlice, useInvalidateDashboard } from '../../hooks/useDashboard'

interface Props {
  serviceId: number
}

export default function RenewalCard({ serviceId }: Props) {
  const forecastEntry = useDashboardSlice(d => d?.forecast?.data?.[0] ?? null)
  const invalidate = useInvalidateDashboard()
  const [refreshing, setRefreshing] = useState(false)

  if (!forecastEntry) return null

  const item = forecastEntry.items.find(
    it => it.next && (it.usi === String(serviceId) || it.user_service_id === String(serviceId)),
  )
  if (!item || !item.next || !item.expire) return null

  const charged = item.next.total ?? 0
  const balance = forecastEntry.balance ?? 0
  const enough = balance >= charged
  const dateLabel = format(parseISO(item.expire.replace(' ', 'T')), 'd MMMM', { locale: ru })

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="glass rounded-2xl flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
          Продление {dateLabel}
        </div>
        <div className="mt-1 text-sm text-slate-200">
          спишется{' '}
          <span className="font-semibold text-white">{charged.toFixed(0)} ₽</span>{' '}
          —{' '}
          <span className={enough ? 'text-emerald-300' : 'text-rose-300'}>
            {enough ? 'хватает' : 'не хватает'}
          </span>
        </div>
      </div>
      <button
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label="Обновить"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 transition-colors disabled:opacity-50"
      >
        <svg
          className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  )
}
