import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO, differenceInDays, isPast } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { UserService, Device } from '../../types'
import DeviceList from './DeviceList'

function StatusBadge({ status }: { status: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    1: { label: 'Активна', cls: 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25' },
    2: { label: 'Заблокирована', cls: 'bg-amber-500/15 text-amber-100 border-amber-500/25' },
    3: { label: 'Удалена', cls: 'bg-rose-500/15 text-rose-100 border-rose-500/25' },
  }
  const state = map[status] ?? { label: 'Неизвестно', cls: 'bg-white/10 text-slate-100 border-white/10' }
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${state.cls}`}>{state.label}</span>
}

function Info({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-sm font-medium ${accent}`}>{value}</div>
    </div>
  )
}

interface Props {
  svc: UserService
  devices?: Device[]
}

export default function ActiveSubscription({ svc, devices }: Props) {
  const expiredAt = svc.expired ? parseISO(svc.expired.replace(' ', 'T')) : null
  const daysLeft = expiredAt ? differenceInDays(expiredAt, new Date()) : null
  const isExpired = expiredAt ? isPast(expiredAt) : false
  const isUrgent = !isExpired && daysLeft !== null && daysLeft <= 5

  const [localDevices, setLocalDevices] = useState<Device[]>(devices ?? [])

  function handleDeviceDeleted(hwid: string) {
    setLocalDevices(prev => prev.filter(d => d.hwid !== hwid))
  }

  return (
    <div className="glass glass-hover rounded-[1.75rem] p-5 animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">{svc.name}</div>
          {svc.descr && <div className="mt-1 text-sm leading-6 text-slate-300">{svc.descr}</div>}
        </div>
        <StatusBadge status={svc.status} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Info
          label="Создана"
          value={svc.created ? format(parseISO(svc.created.replace(' ', 'T')), 'd MMM yyyy', { locale: ru }) : '--'}
        />
        <Info
          label="Истекает"
          value={expiredAt ? format(expiredAt, 'd MMM yyyy', { locale: ru }) : '--'}
          accent={isExpired ? 'text-rose-200' : isUrgent ? 'text-amber-100' : 'text-white'}
        />
        <Info
          label="Стоимость"
          value={
            svc.cost !== undefined
              ? `${svc.cost} \u20BD/${svc.period_type === 'month' ? 'мес' : svc.period_type === 'year' ? 'год' : 'день'}`
              : '--'
          }
          accent="text-fuchsia-100"
        />
      </div>

      {devices !== undefined && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400 mb-1">Устройства</div>
          <DeviceList
            devices={localDevices}
            user_service_id={svc.id}
            onDeleted={handleDeviceDeleted}
          />
        </div>
      )}

      <div className="mt-4">
        <Link
          to="/services"
          className="inline-flex items-center gap-2 rounded-2xl bg-brand-500/18 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-500/28 transition-colors"
        >
          Управление
        </Link>
      </div>
    </div>
  )
}
