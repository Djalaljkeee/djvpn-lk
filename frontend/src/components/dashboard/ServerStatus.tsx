const STATUS_PAGE_URL = import.meta.env.VITE_STATUS_PAGE_URL as string | undefined

function buildEmbedUrl(base: string): string {
  return base.includes('?') ? `${base}&theme=dark` : `${base}?theme=dark`
}

export default function ServerStatus() {
  if (!STATUS_PAGE_URL) {
    return (
      <section className="animate-slide-up">
        <h2 className="text-xl font-semibold text-white mb-4">Статус серверов</h2>
        <div className="glass rounded-[2rem] p-10 text-center">
          <div className="flex items-center justify-center mb-3">
            <svg className="h-10 w-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
            </svg>
          </div>
          <p className="text-sm text-slate-300">Страница мониторинга серверов скоро появится</p>
        </div>
      </section>
    )
  }

  const embedUrl = buildEmbedUrl(STATUS_PAGE_URL)

  return (
    <section className="space-y-4 animate-slide-up">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white">Статус серверов</h2>
        <a
          href={STATUS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-2xl bg-white/5 px-4 py-2.5 text-sm text-white hover:bg-white/10 transition-colors"
        >
          Открыть полностью
        </a>
      </div>

      <div className="glass rounded-[2rem] overflow-hidden">
        {/* Uptime Kuma may require X-Frame-Options / CSP configured to allow embedding */}
        <iframe
          src={embedUrl}
          title="Статус серверов"
          className="w-full border-0"
          style={{ minHeight: '480px', borderRadius: '2rem' }}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </section>
  )
}
