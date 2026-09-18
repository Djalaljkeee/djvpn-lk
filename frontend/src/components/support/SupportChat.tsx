import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
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
  const { thread, messages, pending, loading, error, setError, send, sendFile, retry } =
    useSupportChat(open)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  /** Файл уходит сразу, а набранный текст — подписью к нему. */
  const attach = (file: File | null | undefined) => {
    if (!file) return
    const caption = draft.trim()
    setDraft('')
    void sendFile(file, caption)
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
            {/* Половина обращений в переписке — вопросы из базы знаний.
                Показываем её до того, как человек начнёт печатать. */}
            <p className="mt-5 text-xs">{t('support.faqHint')}</p>
            <Link
              to="/faq"
              onClick={closeChat}
              className="mt-2 inline-block rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white"
            >
              {t('support.openFaq')}
            </Link>
          </div>
        )}
        {items.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            failed={'failed' in m ? (m as { failed?: boolean }).failed : false}
            previewUrl={'previewUrl' in m ? (m as { previewUrl?: string }).previewUrl : undefined}
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
          {error && (
            <div
              role="alert"
              className="mb-2 flex items-start gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-[11px] text-rose-200"
            >
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label={t('support.close')}>
                ✕
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                attach(e.target.files?.[0])
                // Тот же файл, выбранный повторно, не даёт change без сброса.
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={t('support.attach')}
              title={t('support.attachHint', { mb: thread.max_upload_mb })}
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.4 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a2 2 0 01-2.83-2.83l7.78-7.78"
                />
              </svg>
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) submit(e)
              }}
              // Ctrl+V со скриншотом — самый частый способ его приложить.
              onPaste={(e) => {
                const file = Array.from(e.clipboardData.files)[0]
                if (file) {
                  e.preventDefault()
                  attach(file)
                }
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
        {/* Heroicons v2 outline, chat-bubble-oval-left-ellipsis (MIT).
            Родная толщина обводки 1.5 — на 1.8 точки «многоточия» слипаются. */}
        <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 12C8.625 12.2071 8.45711 12.375 8.25 12.375C8.04289 12.375 7.875 12.2071 7.875 12C7.875 11.7929 8.04289 11.625 8.25 11.625C8.45711 11.625 8.625 11.7929 8.625 12ZM8.625 12H8.25M12.375 12C12.375 12.2071 12.2071 12.375 12 12.375C11.7929 12.375 11.625 12.2071 11.625 12C11.625 11.7929 11.7929 11.625 12 11.625C12.2071 11.625 12.375 11.7929 12.375 12ZM12.375 12H12M16.125 12C16.125 12.2071 15.9571 12.375 15.75 12.375C15.5429 12.375 15.375 12.2071 15.375 12C15.375 11.7929 15.5429 11.625 15.75 11.625C15.9571 11.625 16.125 11.7929 16.125 12ZM16.125 12H15.75M21 12C21 16.5563 16.9706 20.25 12 20.25C11.1125 20.25 10.2551 20.1323 9.44517 19.9129C8.47016 20.5979 7.28201 21 6 21C5.80078 21 5.60376 20.9903 5.40967 20.9713C5.25 20.9558 5.0918 20.9339 4.93579 20.906C5.41932 20.3353 5.76277 19.6427 5.91389 18.8808C6.00454 18.4238 5.7807 17.9799 5.44684 17.6549C3.9297 16.1782 3 14.1886 3 12C3 7.44365 7.02944 3.75 12 3.75C16.9706 3.75 21 7.44365 21 12Z"
          />
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
