import { useCallback, useEffect, useState } from 'react'
import { parseISO } from 'date-fns'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import {
  fetchUserServices,
  fetchProfile,
  fetchUserDevices,
  fetchRemnaInfo,
  deleteAllDevices,
} from '../api/user'
import type { UserService, Device, ServiceDevices, RemnaUserInfo } from '../types'
import SubscriptionHero from '../components/dashboard/SubscriptionHero'
import ServerStatus from '../components/dashboard/ServerStatus'
import PlanCard from '../components/dashboard/PlanCard'
import TrafficSection from '../components/dashboard/TrafficSection'
import DeviceConnectionCard from '../components/dashboard/DeviceConnectionCard'
import CountdownBlock from '../components/dashboard/CountdownBlock'
import LocationsSection from '../components/dashboard/LocationsSection'
import CtaBanner from '../components/dashboard/CtaBanner'
import DeviceList from '../components/dashboard/DeviceList'

export default function DashboardPage() {
  const { setUser } = useAuthStore()
  const { show } = useToast()
  const [services, setServices] = useState<UserService[]>([])
  const [devicesMap, setDevicesMap] = useState<Record<number, Device[]>>({})
  const [remnaMap, setRemnaMap] = useState<Record<number, RemnaUserInfo>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [, svcs, devList, remnaList] = await Promise.all([
        fetchProfile().then(setUser),
        fetchUserServices(),
        fetchUserDevices().catch((): ServiceDevices[] => []),
        fetchRemnaInfo().catch((): RemnaUserInfo[] => []),
      ])
      setServices(svcs)
      const dMap: Record<number, Device[]> = {}
      for (const item of devList) dMap[item.user_service_id] = item.devices
      setDevicesMap(dMap)
      const rMap: Record<number, RemnaUserInfo> = {}
      for (const r of remnaList) rMap[r.user_service_id] = r
      setRemnaMap(rMap)
    } catch {
      show('Не удалось загрузить данные', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleRefreshTraffic = async () => {
    setRefreshing(true)
    try {
      const remnaList = await fetchRemnaInfo()
      const rMap: Record<number, RemnaUserInfo> = {}
      for (const r of remnaList) rMap[r.user_service_id] = r
      setRemnaMap(rMap)
    } catch {
      show('Не удалось обновить трафик', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const activeServices = services.filter(s => s.status === 1)
  const svc = activeServices[0] ?? null
  const remnaInfo = svc ? (remnaMap[svc.id] ?? null) : null
  const devices = svc ? (devicesMap[svc.id] ?? []) : []
  const expiredAt = svc?.expired ? parseISO(svc.expired.replace(' ', 'T')) : null

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-32 rounded-2xl bg-white/5" />
        <div className="h-44 rounded-[1.75rem] bg-white/5" />
        <div className="h-16 rounded-[1.75rem] bg-white/5" />
        <div className="h-20 rounded-[1.75rem] bg-white/5" />
        <div className="h-24 rounded-[1.75rem] bg-white/5" />
      </div>
    )
  }

  if (!svc) {
    return (
      <div className="space-y-6 animate-fade-in">
        <SubscriptionHero />
        <ServerStatus />
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold text-white">Подписка</h1>

      <PlanCard svc={svc} remnaInfo={remnaInfo} />

      <TrafficSection
        usedBytes={remnaInfo?.used_traffic_bytes ?? null}
        limitBytes={remnaInfo?.traffic_limit_bytes ?? null}
        onRefresh={handleRefreshTraffic}
        refreshing={refreshing}
      />

      <DeviceConnectionCard
        connectedCount={devices.length}
        limitIp={remnaInfo?.limit_ip ?? null}
      />

      <CountdownBlock expiredAt={expiredAt} />

      <LocationsSection locations={remnaInfo?.locations ?? []} />

      <CtaBanner />

      {/* Мои устройства */}
      <div className="glass rounded-[1.75rem] p-5">
        <DeviceList
          devices={devices}
          user_service_id={svc.id}
          totalLimit={remnaInfo?.limit_ip ?? undefined}
          onDeleted={hwid =>
            setDevicesMap(prev => ({
              ...prev,
              [svc.id]: (prev[svc.id] ?? []).filter(d => d.hwid !== hwid),
            }))
          }
          onDeleteAll={async () => {
            await deleteAllDevices(svc.id)
            setDevicesMap(prev => ({ ...prev, [svc.id]: [] }))
          }}
        />
      </div>

      <ServerStatus />
    </div>
  )
}
