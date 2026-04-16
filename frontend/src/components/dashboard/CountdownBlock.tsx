import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

interface Props {
  expiredAt: Date | null
}

function calcTimeLeft(expiredAt: Date | null): string {
  if (!expiredAt) return '--'
  const diff = expiredAt.getTime() - Date.now()
  if (diff <= 0) return '0 дн. 00:00:00'
  const days = Math.floor(diff / 86400000)
  const h = String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0')
  const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0')
  return `${days} дн.  ${h} : ${m} : ${s}`
}

export default function CountdownBlock({ expiredAt }: Props) {
  const [timeLeft, setTimeLeft] = useState(() => calcTimeLeft(expiredAt))

  useEffect(() => {
    setTimeLeft(calcTimeLeft(expiredAt))
    const id = setInterval(() => setTimeLeft(calcTimeLeft(expiredAt)), 1000)
    return () => clearInterval(id)
  }, [expiredAt])

  return (
    <div className="glass rounded-[1.75rem] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span className="text-xs uppercase tracking-[0.18em] text-slate-400">Осталось</span>
          </div>
          <div className="font-mono text-3xl font-black text-white tracking-tight leading-none">
            {timeLeft}
          </div>
        </div>
        {expiredAt && (
          <div className="text-right shrink-0">
            <div className="text-xs text-slate-400">Действует до:</div>
            <div className="mt-1 text-sm text-white">
              {format(expiredAt, 'd MMM yyyy г.', { locale: ru })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
