import type { SupportMessage } from '../../api/support'

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
}: {
  message: SupportMessage
  failed?: boolean
  onRetry?: () => void
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
