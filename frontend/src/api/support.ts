import api from './client'

/** Загрузка 10 МБ с мобильной сети в 15 секунд обычного таймаута не влезает. */
const UPLOAD_TIMEOUT_MS = 60_000

export interface SupportAttachment {
  id: number
  /** photo — рисуем прямо в переписке, document — ссылкой на скачивание. */
  kind: 'photo' | 'document'
  name: string
  mime: string
  size: number
}

export interface SupportMessage {
  id: number
  direction: 'in' | 'out'
  author: 'customer' | 'staff' | 'system'
  body: string
  delivery: 'queued' | 'sent' | 'failed' | 'na'
  created_at: string
  attachment?: SupportAttachment | null
}

export interface SupportThread {
  enabled: boolean
  status: 'open' | 'closed' | 'banned'
  ticket_id: number | null
  unread: number
  last_message_at: string | null
  max_upload_mb: number
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

/** Файл отдаётся под сессионной кукой — это обычный same-origin GET. */
export const supportAttachmentUrl = (id: number): string =>
  `${api.defaults.baseURL ?? '/api'}/support/attachments/${id}`

/**
 * Отправляет файл в переписку. `Content-Type` задан руками не для сервера:
 * без него axios увидел бы json-заголовок инстанса и сериализовал FormData
 * в JSON, потеряв файл; с ним браузер сам подставит boundary.
 */
export const uploadSupportAttachment = (
  file: File,
  clientMsgId: string,
  caption = '',
): Promise<SupportMessage> => {
  const form = new FormData()
  form.append('file', file)
  form.append('client_msg_id', clientMsgId)
  form.append('caption', caption)
  return api
    .post<SupportMessage>('/support/attachments', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT_MS,
    })
    .then((r) => r.data)
}

export const markSupportRead = (): Promise<void> =>
  api.post('/support/read').then(() => undefined)
