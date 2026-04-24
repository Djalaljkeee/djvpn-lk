import { useEffect, useRef, useState } from 'react'

import { useNotifications } from '../hooks/useNotifications'
import type { NotificationItem } from '../api/notifications'

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function notificationTitle(n: NotificationItem): string {
  const title = (n.payload as { title?: string })?.title
  if (title && typeof title === 'string') return title
  switch (n.type) {
    case 'payment.received': return 'Платёж зачислен'
    case 'service.expiring': return 'Скоро истечёт подписка'
    case 'service.expired':  return 'Подписка истекла'
    case 'cart.reminder':    return 'Незавершённая покупка'
    default:                 return n.type
  }
}

function notificationBody(n: NotificationItem): string {
  const body = (n.payload as { body?: string; message?: string })
  return body.body || body.message || ''
}

export default function NotificationBell() {
  const { inbox, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10"
      >
        <svg className="h-5 w-5 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {inbox.unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {inbox.unread > 99 ? '99+' : inbox.unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-white/10 bg-[rgba(31,12,45,0.96)] p-2 shadow-2xl backdrop-blur-2xl animate-fade-in">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-semibold text-white">Уведомления</span>
            {inbox.unread > 0 && (
              <button
                onClick={() => void markAllRead()}
                className="text-xs text-brand-300 hover:text-brand-200"
              >
                Прочитать все
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {inbox.items.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">
                Пока ничего нет
              </div>
            ) : (
              inbox.items.map((n) => {
                const isUnread = !n.read_at
                return (
                  <button
                    key={n.id}
                    onClick={() => void markRead(n.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left hover:bg-white/5 ${isUnread ? 'bg-white/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-white">{notificationTitle(n)}</span>
                      {isUnread && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-brand-400" />}
                    </div>
                    {notificationBody(n) && (
                      <p className="mt-0.5 text-xs text-slate-300">{notificationBody(n)}</p>
                    )}
                    <span className="mt-1 block text-[10px] text-slate-400">{formatWhen(n.created_at)}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
