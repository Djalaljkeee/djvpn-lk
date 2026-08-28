import api from './client'

export interface SupportMessage {
  id: number
  direction: 'in' | 'out'
  author: 'customer' | 'staff' | 'system'
  body: string
  delivery: 'queued' | 'sent' | 'failed' | 'na'
  created_at: string
}

export interface SupportThread {
  enabled: boolean
  status: 'open' | 'closed' | 'banned'
  ticket_id: number | null
  unread: number
  last_message_at: string | null
}

export interface SupportList {
  thread: SupportThread
  items: SupportMessage[]
}

/** Дешёвая ручка для бейджа: без списка сообщений. */
export const fetchSupportThread = (): Promise<SupportThread> =>
  api.get<SupportThread>('/support/thread').then((r) => r.data)

/** `afterId > 0` — инкрементальная догрузка, иначе последние сообщения. */
export const fetchSupportMessages = (afterId = 0, limit = 50): Promise<SupportList> =>
  api
    .get<SupportList>('/support/messages', { params: { after_id: afterId, limit } })
    .then((r) => r.data)

export const sendSupportMessage = (text: string, clientMsgId: string): Promise<SupportMessage> =>
  api
    .post<SupportMessage>('/support/messages', { text, client_msg_id: clientMsgId })
    .then((r) => r.data)

export const markSupportRead = (): Promise<void> =>
  api.post('/support/read').then(() => undefined)
