import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchSupportMessages,
  fetchSupportThread,
  markSupportRead,
  sendSupportMessage,
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
}

/** Локальное сообщение, ещё не подтверждённое сервером. */
export interface PendingMessage extends SupportMessage {
  clientMsgId: string
  failed?: boolean
}

export function useSupportChat(open: boolean) {
  const [thread, setThread] = useState<SupportThread>(EMPTY_THREAD)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState(true)
  const lastIdRef = useRef(0)

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
    const clientMsgId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

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

  const retry = useCallback(async (clientMsgId: string) => {
    const item = pending.find((p) => p.clientMsgId === clientMsgId)
    if (!item) return
    setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId))
    await send(item.body)
  }, [pending, send])

  return { thread, messages, pending, loading, send, retry, refresh }
}
