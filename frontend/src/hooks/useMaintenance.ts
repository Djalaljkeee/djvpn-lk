import { useEffect, useState } from 'react'

import { fetchMaintenanceStatus, type MaintenanceStatus } from '../api/system'

const REFRESH_MS = 60_000

export function useMaintenance(): MaintenanceStatus {
  const [status, setStatus] = useState<MaintenanceStatus>({ enabled: false, message: '' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const next = await fetchMaintenanceStatus()
        if (!cancelled) setStatus(next)
      } catch {
        /* keep previous */
      }
    }
    void load()
    const handle = window.setInterval(() => { void load() }, REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  return status
}
