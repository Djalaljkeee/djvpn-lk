import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import { fetchUserServices, fetchProfile, fetchRemnaInfo, fetchUserDevices, fetchServiceOrders } from '../api/user'
import { buyService } from '../api/services'
import type { UserService, RemnaUserInfo, ServiceDevices } from '../types'
import SubscriptionHero from '../components/dashboard/SubscriptionHero'
import ServerStatus from '../components/dashboard/ServerStatus'
import CompactSubscriptionCard from '../components/dashboard/CompactSubscriptionCard'
import TrialOfferCard from '../components/dashboard/TrialOfferCard'

const TRIAL_SERVICE_ID = 4

export default function DashboardPage() {
  const { setUser } = useAuthStore()
  const { show } = useToast()
  const [services, setServices] = useState<UserService[]>([])
  const [remnaMap, setRemnaMap] = useState<Record<number, RemnaUserInfo>>({})
  const [devicesMap, setDevicesMap] = useState<Record<number, number>>({})
  const [trialAvailable, setTrialAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [, svcs, remnaList, devList, orders] = await Promise.all([
        fetchProfile().then(setUser),
        fetchUserServices(),
        fetchRemnaInfo().catch((): RemnaUserInfo[] => []),
        fetchUserDevices().catch((): ServiceDevices[] => []),
        fetchServiceOrders().catch((): { service_id: number }[] => []),
      ])
      setServices(svcs)
      const rMap: Record<number, RemnaUserInfo> = {}
      for (const r of remnaList) rMap[r.user_service_id] = r
      setRemnaMap(rMap)
      const dMap: Record<number, number> = {}
      for (const item of devList) dMap[item.user_service_id] = item.devices.length
      setDevicesMap(dMap)
      setTrialAvailable(!orders.some(o => o.service_id === TRIAL_SERVICE_ID))
    } catch {
      show('Не удалось загрузить данные', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const activeServices = services.filter(s => s.status === 1)

  const handleActivateTrial = async () => {
    setActivating(true)
    try {
      await buyService(TRIAL_SERVICE_ID)
      show('Пробный период активирован', 'success')
      await loadAll()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Не удалось активировать пробный период', 'error')
    } finally {
      setActivating(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded-2xl bg-white/5" />
        <div className="h-44 rounded-[1.75rem] bg-white/5" />
        <div className="h-32 rounded-[1.75rem] bg-white/5" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {activeServices.length > 0 ? (
        <>
          {activeServices.map(svc => (
            <CompactSubscriptionCard
              key={svc.id}
              svc={svc}
              remna={remnaMap[svc.id] ?? null}
              devicesCount={devicesMap[svc.id] ?? 0}
            />
          ))}
        </>
      ) : trialAvailable ? (
        <TrialOfferCard onActivate={handleActivateTrial} loading={activating} />
      ) : (
        <SubscriptionHero />
      )}

      <ServerStatus />
    </div>
  )
}
