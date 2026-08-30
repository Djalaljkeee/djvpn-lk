import { supportAttachmentUrl, type SupportAttachment, type SupportMessage } from '../../api/support'

function humanSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
    : `${Math.max(1, Math.round(bytes / 1024))} КБ`
}

/**
 * Вложение: картинка рисуется прямо в пузыре, всё остальное — плашкой со
 * ссылкой. `previewUrl` подставляется, пока файл ещё грузится: у локальной
 * копии id с сервера ещё нет.
 */
function Attachment({
  attachment,
  previewUrl,
}: {
  attachment: SupportAttachment
  previewUrl?: string
}) {
  const url = previewUrl || (attachment.id ? supportAttachmentUrl(attachment.id) : '')

  if (attachment.kind === 'photo' && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mb-1 block">
        <img
          src={url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-64 rounded-xl object-contain"
        />
      </a>
    )
  }

  const body = (
    <>
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.4 11.05l-8.49 8.49a5 5 0 01-7.07-7.07l8.49-8.49a3.5 3.5 0 014.95 4.95l-8.49 8.49a2 2 0 01-2.83-2.83l7.78-7.78"
        />
      </svg>
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <span className="shrink-0 text-[10px] text-slate-400">{humanSize(attachment.size)}</span>
    </>
  )
  const className = 'mb-1 flex items-center gap-2 rounded-xl bg-black/25 px-2 py-1.5 text-xs'

  // Пока файл не сохранён, скачивать нечего — показываем ту же плашку без ссылки.
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className={`${className} hover:bg-black/40`}
    >
      {body}
    </a>
  ) : (
    <div className={`${className} opacity-70`}>{body}</div>
  )
}

/**
 * Одно сообщение переписки.
 *
 * Текст рендерится как текстовый узел React — никакого `innerHTML`: тело
 * сообщения пишет сотрудник, и оно приходит сырым, без экранирования.
 */
export default function MessageBubble({
  message,
  failed,
  onRetry,
  previewUrl,
}: {
  message: SupportMessage
  failed?: boolean
  onRetry?: () => void
  previewUrl?: string
}) {
  const mine = message.direction === 'in'
  const time = (() => {
    try {
      return new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  })()

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
          mine
            ? 'bg-brand-500/25 text-white rounded-br-md'
            : 'bg-white/10 text-slate-100 rounded-bl-md',
        ].join(' ')}
      >
        {!mine && (
          <div className="mb-0.5 text-[11px] font-semibold text-brand-300">
            {message.author === 'system' ? 'Система' : 'Поддержка'}
          </div>
        )}
        {message.attachment && (
          <Attachment attachment={message.attachment} previewUrl={previewUrl} />
        )}
        {message.body}
        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] text-slate-400">
          {failed ? (
            <button onClick={onRetry} className="text-rose-300 hover:text-rose-200">
              не отправлено — повторить
            </button>
          ) : (
            <>
              {mine && message.delivery === 'queued' && <span>отправляется…</span>}
              <span>{time}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
