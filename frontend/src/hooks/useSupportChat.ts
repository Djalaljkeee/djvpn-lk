import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchSupportMessages,
  fetchSupportThread,
  markSupportRead,
  sendSupportMessage,
  uploadSupportAttachment,
  type SupportMessage,
  type SupportThread,
} from '../api/support'

/**
 * Интервалы поллинга. Websocket сознательно не используется: uvicorn запущен
 * одним воркером с `--limit-concurrency 200`, и сотня открытых соединений
 * выела бы этот бюджет, положив кабинет целиком.
 */
const POLL_OPEN_MS = 4_000
const POLL_HIDDEN_MS = 20_000
const POLL_CLOSED_MS = 60_000

const EMPTY_THREAD: SupportThread = {
  enabled: false,
  status: 'open',
  ticket_id: null,
  unread: 0,
  last_message_at: null,
  max_upload_mb: 10,
}

/** Локальное сообщение, ещё не подтверждённое сервером. */
export interface PendingMessage extends SupportMessage {
  clientMsgId: string
  failed?: boolean
  /** blob-ссылка на выбранный файл: превью видно, пока файл ещё грузится. */
  previewUrl?: string
}

function newClientMsgId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

export function useSupportChat(open: boolean) {
  const [thread, setThread] = useState<SupportThread>(EMPTY_THREAD)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const lastIdRef = useRef(0)
  // Выбранные файлы держим здесь: повтор неудачной отправки заливает тот же
  // File, а не просит клиента выбрать его заново.
  const filesRef = useRef(new Map<string, { file: File; caption: string }>())

  // Эффект очистки не должен пересобираться на каждое сообщение — держим
  // актуальный список в ref.
  const pendingRef = useRef<PendingMessage[]>([])
  pendingRef.current = pending

  const applyIncoming = useCallback((items: SupportMessage[]) => {
    if (!items.length) return
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id))
      const merged = [...prev, ...items.filter((m) => !seen.has(m.id))]
      merged.sort((a, b) => a.id - b.id)
      return merged
    })
    lastIdRef.current = Math.max(lastIdRef.current, ...items.map((m) => m.id))
  }, [])

  const refresh = useCallback(async () => {
    try {
      if (!open && lastIdRef.current > 0) {
        // Закрытый виджет тянет одну строку треда — этого хватает для бейджа.
        setThread(await fetchSupportThread())
        return
      }
      const data = await fetchSupportMessages(lastIdRef.current)
      setThread(data.thread)
      applyIncoming(data.items)
      // Ответы сервера вытесняют оптимистичные копии тех же сообщений.
      setPending((prev) => prev.filter((p) => !data.items.some((m) => m.id === p.id)))
    } catch {
      setThread((t) => (t.enabled ? t : EMPTY_THREAD))
    } finally {
      setLoading(false)
    }
  }, [applyIncoming, open])

  useEffect(() => {
    void refresh()
    let handle = 0
    const schedule = () => {
      window.clearInterval(handle)
      const interval = !open
        ? POLL_CLOSED_MS
        : document.visibilityState === 'hidden'
          ? POLL_HIDDEN_MS
          : POLL_OPEN_MS
      handle = window.setInterval(() => { void refresh() }, interval)
    }
    schedule()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
      schedule()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(handle)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, open])

  // Открытый чат гасит бейдж непрочитанных.
  useEffect(() => {
    if (!open || !thread.unread) return
    void markSupportRead().then(() => setThread((t) => ({ ...t, unread: 0 })))
  }, [open, thread.unread])

  const send = useCallback(async (text: string) => {
    const body = text.trim()
    if (!body) return
    const clientMsgId = newClientMsgId()

    const optimistic: PendingMessage = {
      id: -Date.now(),
      direction: 'in',
      author: 'customer',
      body,
      delivery: 'queued',
      created_at: new Date().toISOString(),
      clientMsgId,
    }
    setPending((prev) => [...prev, optimistic])

    try {
      const saved = await sendSupportMessage(body, clientMsgId)
      setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId))
      applyIncoming([saved])
    } catch {
      setPending((prev) =>
        prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
      )
    }
  }, [applyIncoming])

  /**
   * Отправляет файл: оптимистичная копия с локальным превью, затем ответ
   * сервера её вытесняет. Размер проверяем и здесь — чтобы не гнать 20 МБ по
   * мобильной сети ради 413.
   */
  const sendFile = useCallback(async (file: File, caption = '') => {
    const limitMb = thread.max_upload_mb || 10
    if (file.size > limitMb * 1024 * 1024) {
      setError(`Файл ${humanSize(file.size)} — больше ${limitMb} МБ. Пришлите его в Telegram.`)
      return
    }
    setError('')

    const clientMsgId = newClientMsgId()
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined
    filesRef.current.set(clientMsgId, { file, caption })

    const optimistic: PendingMessage = {
      id: -Date.now(),
      direction: 'in',
      author: 'customer',
      body: caption,
      delivery: 'queued',
      created_at: new Date().toISOString(),
      clientMsgId,
      previewUrl,
      attachment: {
        id: 0,
        kind: isImage ? 'photo' : 'document',
        name: file.name,
        mime: file.type,
        size: file.size,
      },
    }
    setPending((prev) => [...prev, optimistic])

    try {
      const saved = await uploadSupportAttachment(file, clientMsgId, caption)
      setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId))
      filesRef.current.delete(clientMsgId)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      applyIncoming([saved])
    } catch (e: any) {
      setPending((prev) =>
        prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
      )
      setError(
        e?.response?.status === 413
          ? `Файл больше ${limitMb} МБ — пришлите его в Telegram.`
          : 'Файл не отправился. Попробуйте ещё раз.',
      )
    }
  }, [applyIncoming, thread.max_upload_mb])

  const retry = useCallback(async (clientMsgId: string) => {
    const item = pending.find((p) => p.clientMsgId === clientMsgId)
    if (!item) return
    const attached = filesRef.current.get(clientMsgId)
    setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId))
    filesRef.current.delete(clientMsgId)
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    if (attached) {
      await sendFile(attached.file, attached.caption)
      return
    }
    await send(item.body)
  }, [pending, send, sendFile])

  // Блобы переживают закрытие виджета, если их не отпустить руками.
  useEffect(() => () => {
    pendingRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
  }, [])

  return { thread, messages, pending, loading, error, setError, send, sendFile, retry, refresh }
}
