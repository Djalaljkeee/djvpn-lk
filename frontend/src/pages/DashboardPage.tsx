import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import { fetchUserServices, fetchProfile, fetchUserDevices } from '../api/user'
import type { UserService, Device, ServiceDevices } from '../types'
import { parseISO, differenceInDays } from 'date-fns'
import SubscriptionHero from '../components/dashboard/SubscriptionHero'
import ActiveSubscription from '../components/dashboard/ActiveSubscription'
import ServerStatus from '../components/dashboard/ServerStatus'

export default function DashboardPage() {
  const { setUser } = useAuthStore()
  const { show } = useToast()
  const [services, setServices] = useState<UserService[]>([])
  const [devicesMap, setDevicesMap] = useState<Record<number, Device[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetchProfile().then(setUser),
      fetchUserServices().then(setServices),
      fetchUserDevices().then((list: ServiceDevices[]) => {
        const map: Record<number, Device[]> = {}
        for (const item of list) {
          map[item.user_service_id] = item.devices
        }
        setDevicesMap(map)
      }).catch(() => {}), // не ломаем страницу если Remnawave недоступен
    ])
      .catch(() => show('Не удалось загрузить данные', 'error'))
      .finally(() => setLoading(false))
  }, [])

  const activeServices = services.filter(s => s.status === 1)
  const urgentServices = activeServices.filter(s => {
    if (!s.expired) return false
    const days = differenceInDays(parseISO(s.expired.replace(' ', 'T')), new Date())
    return days <= 5
  })

  return (
    <div className="space-y-6 animate-fade-in">
      {urgentServices.length > 0 && (
        <div className="rounded-[1.75rem] border border-amber-300/20 bg-amber-500/10 p-4 text-amber-50">
          <div className="text-sm font-semibold">Скоро истекают услуги</div>
          <div className="mt-1 text-sm text-amber-100/90">{urgentServices.map(s => s.name).join(', ')}</div>
        </div>
      )}

      {loading ? (
        <div className="h-[340px] sm:h-[420px] rounded-[2rem] bg-white/5 animate-pulse" />
      ) : activeServices.length === 0 ? (
        <SubscriptionHero />
      ) : (
        <section>
          <h2 className="text-xl font-semibold text-white mb-4">Активные подписки</h2>
          <div className="space-y-3">
            {activeServices.map(svc => (
              <ActiveSubscription
                key={svc.id}
                svc={svc}
                devices={devicesMap[svc.id]}
              />
            ))}
          </div>
        </section>
      )}

      <ServerStatus />
    </div>
  )
}
