import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { buyService } from '../api/services'
import { useDashboard, useDashboardSlice, useInvalidateDashboard } from '../hooks/useDashboard'
import SubscriptionHero from '../components/dashboard/SubscriptionHero'
import ServerStatus from '../components/dashboard/ServerStatus'
import CompactSubscriptionCard from '../components/dashboard/CompactSubscriptionCard'
import TrafficMiniCard from '../components/dashboard/TrafficMiniCard'
import DevicesMiniCard from '../components/dashboard/DevicesMiniCard'
import RenewalCard from '../components/dashboard/RenewalCard'
import TrialOfferCard from '../components/dashboard/TrialOfferCard'
import CartBanner from '../components/CartBanner'
import { useCart } from '../hooks/useCart'
import { resolveDeviceLimit } from '../utils/deviceLimit'

const TRIAL_SERVICE_ID = 4

export default function DashboardPage() {
  const { show } = useToast()
  const { data, loading, error } = useDashboard()
  const services = useDashboardSlice(d => d?.services ?? [])
  const remnaList = useDashboardSlice(d => d?.remna_info ?? [])
  const devicesList = useDashboardSlice(d => d?.devices ?? [])
  const orders = useDashboardSlice(d => d?.orders ?? [])
  const invalidate = useInvalidateDashboard()
  const [activating, setActivating] = useState(false)
  const { state: cart, clear: clearCartState } = useCart()

  const remnaMap = useMemo(
    () => Object.fromEntries(remnaList.map(r => [r.user_service_id, r])),
    [remnaList],
  )
  const devicesMap = useMemo(
    () => Object.fromEntries(devicesList.map(d => [d.user_service_id, d.devices.length])),
    [devicesList],
  )
  const trialAvailable = orders.some(o => o.service_id === TRIAL_SERVICE_ID)
  const activeServices = services.filter(s => s.status === 1)

  const handleActivateTrial = async () => {
    setActivating(true)
    try {
      await buyService(TRIAL_SERVICE_ID)
      show('Пробный период активирован', 'success')
      await invalidate()
    } catch (e: any) {
      show(e?.response?.data?.detail || 'Не удалось активировать пробный период', 'error')
    } finally {
      setActivating(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded-2xl bg-white/5" />
        <div className="h-44 rounded-[1.75rem] bg-white/5" />
        <div className="h-32 rounded-[1.75rem] bg-white/5" />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="rounded-[1.75rem] border border-rose-300/30 bg-rose-500/10 p-6 text-rose-100">
        Не удалось загрузить данные. Обновите страницу.
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {!cart.empty && cart.payload && (
        <CartBanner payload={cart.payload} onDismiss={() => void clearCartState()} />
      )}
      {activeServices.length > 0 ? (
        <>
          {activeServices.map(svc => {
            const remna = remnaMap[svc.id] ?? null
            const devicesCount = devicesMap[svc.id] ?? 0
            const limitIp = resolveDeviceLimit(remna)
            return (
              <div key={svc.id} className="space-y-3">
                <CompactSubscriptionCard
                  svc={svc}
                  remna={remna}
                  devicesCount={devicesCount}
                />
                <div className="grid grid-cols-2 gap-3">
                  <TrafficMiniCard
                    usedBytes={remna?.used_traffic_bytes ?? null}
                    limitBytes={remna?.traffic_limit_bytes ?? null}
                  />
                  <DevicesMiniCard used={devicesCount} limit={limitIp} />
                </div>
                <RenewalCard serviceId={svc.id} />
              </div>
            )
          })}
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
