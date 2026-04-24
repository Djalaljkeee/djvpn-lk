import { useCallback, useEffect, useState } from 'react'

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationInbox,
} from '../api/notifications'

const REFRESH_MS = 60_000

export function useNotifications() {
  const [inbox, setInbox] = useState<NotificationInbox>({ items: [], unread: 0 })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchNotifications()
      setInbox(next)
    } catch {
      setInbox({ items: [], unread: 0 })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const handle = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => window.clearInterval(handle)
  }, [refresh])

  const markRead = useCallback(async (id: number) => {
    try {
      await markNotificationRead(id)
    } finally {
      await refresh()
    }
  }, [refresh])

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead()
    } finally {
      await refresh()
    }
  }, [refresh])

  return { inbox, loading, refresh, markRead, markAllRead }
}
