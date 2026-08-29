import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { useSupportChat } from '../../hooks/useSupportChat'
import { useSupportChatStore } from '../../store/supportChatStore'
import MessageBubble from './MessageBubble'

const TELEGRAM_FALLBACK = 'https://t.me/help_djvpn'

/**
 * Чат поддержки: плавающая кнопка на всех страницах кабинета и панель переписки.
 *
 * Обращение уходит в тот же тикет и ту же тему, что и вопрос из Telegram, —
 * кабинет здесь второй фронтенд к одной очереди, а не отдельный канал.
 */
export default function SupportChat() {
  const { t } = useTranslation()
  const { open, openChat, closeChat, toggleChat } = useSupportChatStore()
  const { thread, messages, pending, loading, send, retry } = useSupportChat(open)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // Ссылка из телеграм-дубля ответа ведёт сразу в открытый чат.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('support') === '1') openChat()
  }, [openChat])

  const items = useMemo(() => [...messages, ...pending], [messages, pending])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [open, items.length])

  // На мобиле панель занимает экран целиком — фон скроллиться не должен.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!thread.enabled && !open) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void send(text)
  }

  const panel = (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-[rgba(20,8,30,0.98)] backdrop-blur-2xl md:inset-auto md:bottom-6 md:right-6 md:h-[560px] md:w-[380px] md:rounded-3xl md:border md:border-white/10 md:shadow-2xl"
      role="dialog"
      aria-label={t('support.title')}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">{t('support.title')}</div>
          <div className="text-[11px] text-slate-400">
            {thread.ticket_id ? `${t('support.ticket')} #${thread.ticket_id}` : t('support.subtitle')}
          </div>
        </div>
        <button
          onClick={closeChat}
          aria-label={t('support.close')}
          className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading && !items.length && <div className="text-sm text-slate-400">{t('support.loading')}</div>}
        {!loading && !items.length && (
          <div className="mt-6 text-center text-sm text-slate-400">
            <p>{t('support.empty')}</p>
            <p className="mt-2 text-xs">{t('support.emptyHint')}</p>
          </div>
        )}
        {items.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            failed={'failed' in m ? (m as { failed?: boolean }).failed : false}
            onRetry={'clientMsgId' in m ? () => void retry((m as { clientMsgId: string }).clientMsgId) : undefined}
          />
        ))}
        <div ref={endRef} />
      </div>

      {thread.status === 'banned' ? (
        <div className="border-t border-white/10 px-4 py-3 text-sm text-slate-400">
          {t('support.banned')}
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="border-t border-white/10 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]"
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) submit(e)
              }}
              rows={1}
              maxLength={4000}
              placeholder={t('support.placeholder')}
              className="max-h-32 min-h-[42px] flex-1 resize-y rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="flex h-[42px] items-center rounded-2xl bg-brand-500 px-4 text-sm font-semibold text-white disabled:opacity-40"
            >
              {t('support.send')}
            </button>
          </div>
          <a
            href={TELEGRAM_FALLBACK}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block text-center text-[11px] text-slate-500 hover:text-slate-300"
          >
            {t('support.openInTelegram')}
          </a>
        </form>
      )}
    </div>
  )

  return (
    <>
      <button
        onClick={toggleChat}
        aria-label={t('support.title')}
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-40 flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-brand-500 shadow-xl transition hover:bg-brand-400 md:bottom-6"
      >
        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h5m-5 7l-3.5-3.5A8.5 8.5 0 1121 12a8.5 8.5 0 01-8.5 8.5H8z" />
        </svg>
        {thread.unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {thread.unread > 99 ? '99+' : thread.unread}
          </span>
        )}
      </button>
      {open && createPortal(panel, document.body)}
    </>
  )
}
