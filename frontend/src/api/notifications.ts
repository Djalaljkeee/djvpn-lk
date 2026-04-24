import api from './client'

export interface NotificationItem {
  id: number
  type: string
  payload: Record<string, unknown>
  read_at?: string | null
  created_at: string
}

export interface NotificationInbox {
  items: NotificationItem[]
  unread: number
}

export const fetchNotifications = (limit = 20): Promise<NotificationInbox> =>
  api.get<NotificationInbox>('/user/notifications', { params: { limit } }).then((r) => r.data)

export const markNotificationRead = (id: number): Promise<void> =>
  api.post(`/user/notifications/${id}/read`).then(() => undefined)

export const markAllNotificationsRead = (): Promise<void> =>
  api.post('/user/notifications/read-all').then(() => undefined)
