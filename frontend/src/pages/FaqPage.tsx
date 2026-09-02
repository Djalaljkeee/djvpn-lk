import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { FAQ_CATEGORIES, FAQ_ITEMS, searchFaq } from '../data/faq'
import type { FaqCategory, FaqItem } from '../data/faq'
import { useSupportChatStore } from '../store/supportChatStore'

type Filter = FaqCategory | 'all'

export default function FaqPage() {
  const { t, i18n } = useTranslation()
  const openChat = useSupportChatStore(s => s.openChat)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // Открытые ответы: несколько сразу — люди сравнивают соседние пункты,
  // схлопывать предыдущий при открытии следующего только мешает.
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Ссылка вида /faq#reset-app (её даёт поддержка в переписке) должна
  // открывать нужный ответ, а не просто вести на страницу.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!id || !FAQ_ITEMS.some(i => i.id === id)) return
    setOpenIds(new Set([id]))
    // Ждём кадр: до рендера списка узла ещё нет.
    requestAnimationFrame(() => {
      itemRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [])

  const visible = useMemo(() => {
    const byCategory = filter === 'all' ? FAQ_ITEMS : FAQ_ITEMS.filter(i => i.category === filter)
    return searchFaq(byCategory, query)
  }, [filter, query])

  const counts = useMemo(() => {
    const found = searchFaq(FAQ_ITEMS, query)
    const map = { all: found.length } as Record<Filter, number>
    for (const c of FAQ_CATEGORIES) map[c] = found.filter(i => i.category === c).length
    return map
  }, [query])

  const toggle = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-white sm:text-3xl">
          <span className="gradient-text">{t('faq.title')}</span>
        </h1>
        <p className="max-w-2xl text-sm text-slate-300">{t('faq.subtitle')}</p>
      </header>

      {!i18n.language.startsWith('ru') && (
        <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          {t('faq.ruOnly')}
        </p>
      )}

      <div className="glass rounded-3xl p-4 sm:p-5">
        <label className="relative block">
          <span className="sr-only">{t('faq.searchLabel')}</span>
          <svg
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('faq.searchPlaceholder')}
            className="w-full rounded-2xl border border-white/10 bg-surface-3 py-3 pl-12 pr-4 text-sm text-white placeholder:text-slate-400 focus:border-brand-500/60 focus:outline-none"
          />
        </label>

        <div className="mt-4 flex flex-wrap gap-2">
          {(['all', ...FAQ_CATEGORIES] as Filter[]).map(c => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              disabled={counts[c] === 0}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
                filter === c
                  ? 'bg-brand-500/25 text-white shadow-brand'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {t(`faq.category.${c}`)}
              <span className="ml-1.5 font-mono text-[11px] text-slate-400">{counts[c]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="glass rounded-3xl px-5 py-10 text-center">
          <p className="text-sm text-slate-300">{t('faq.nothingFound')}</p>
          <button
            onClick={openChat}
            className="mt-4 rounded-2xl bg-brand-500/25 px-5 py-2.5 text-sm font-medium text-white shadow-brand hover:bg-brand-500/35"
          >
            {t('faq.askSupport')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(item => (
            <FaqRow
              key={item.id}
              item={item}
              open={openIds.has(item.id)}
              onToggle={() => toggle(item.id)}
              anchorRef={el => { itemRefs.current[item.id] = el }}
            />
          ))}
        </div>
      )}

      <div className="brand-panel rounded-3xl px-5 py-6 text-center">
        <p className="text-sm text-white">{t('faq.stillStuck')}</p>
        <button
          onClick={openChat}
          className="mt-3 rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20"
        >
          {t('faq.askSupport')}
        </button>
      </div>
    </div>
  )
}

/**
 * Строка аккордеона на <button>, а не на <details>/<summary>: в Safari < 17 и
 * Chromium < 89 любой `display`, отличный от `list-item`, на самом <summary>
 * ломает нативный toggle, а без flex-раскладки иконку не поставить.
 */
function FaqRow({
  item, open, onToggle, anchorRef,
}: {
  item: FaqItem
  open: boolean
  onToggle: () => void
  anchorRef: (el: HTMLDivElement | null) => void
}) {
  const panelId = `faq-panel-${item.id}`

  return (
    <div ref={anchorRef} id={item.id} className="glass glass-hover rounded-2xl transition-colors">
      <button
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
      >
        <span className="flex-1 text-sm font-medium text-white sm:text-[15px]">{item.q}</span>
        <svg
          className={`h-5 w-5 flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div id={panelId} className="space-y-3 px-4 pb-5 text-sm leading-relaxed text-slate-300 sm:px-5">
          {item.a.map((p, i) => <p key={i}>{p}</p>)}

          {item.steps && (
            <ol className="space-y-2 rounded-2xl bg-white/5 px-4 py-3">
              {item.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/25 text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}

          {item.links && (
            <div className="flex flex-wrap gap-2 pt-1">
              {item.links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white"
                >
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
