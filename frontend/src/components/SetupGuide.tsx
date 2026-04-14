import { useEffect, useState } from 'react'
import api from '../api/client'

interface SetupData {
  platform: string
  subscription_url: string
  step1: {
    title: string
    app_name: string
    download_url: string
    all_downloads: Record<string, string>
  }
  step2: {
    title: string
    deeplink: string
    copy_link: string
    qr_code: string
  }
  fallback: {
    title: string
    instruction: string
    copy_link: string
  }
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="w-full py-3 rounded-xl bg-surface-3 border border-white/10 text-sm font-medium text-slate-300 hover:text-white hover:border-white/20 transition-all flex items-center justify-center gap-2"
    >
      {copied ? (
        <>
          <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Скопировано
        </>
      ) : (
        <>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
          {label ?? 'Скопировать ссылку'}
        </>
      )}
    </button>
  )
}

const PLATFORM_ICONS: Record<string, string> = {
  ios: '📱',
  android: '📱',
  windows: '💻',
  macos: '💻',
}

const PLATFORM_LABELS: Record<string, string> = {
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
}

export default function SetupGuide({
  subUrl,
  serviceId,
  onClose,
}: {
  subUrl?: string
  serviceId?: number
  onClose: () => void
}) {
  const [data, setData] = useState<SetupData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [step, setStep] = useState(1)

  useEffect(() => {
    const req = serviceId
      ? api.get<SetupData>(`/user/service/${serviceId}/config`)
      : api.get<SetupData>('/vpn/setup', { params: { url: subUrl } })

    req
      .then(r => setData(r.data))
      .catch(() => setError('Не удалось загрузить настройки. Скопируйте ссылку вручную.'))
      .finally(() => setLoading(false))
  }, [subUrl, serviceId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass rounded-2xl w-full max-w-md overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <h2 className="font-bold text-white text-base">Настройка VPN</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-surface-3 text-slate-400 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {loading ? (
            <div className="space-y-4 animate-pulse py-8">
              <div className="h-20 bg-surface-3 rounded-xl" />
              <div className="h-14 bg-surface-3 rounded-xl" />
              <div className="h-14 bg-surface-3 rounded-xl" />
            </div>
          ) : error ? (
            /* Fallback: show manual instructions */
            <div className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl mb-3">⚠️</div>
                <p className="text-sm text-slate-400">{error}</p>
              </div>
              {subUrl && <CopyBtn text={subUrl} label="Скопировать ссылку подписки" />}
              <div className="bg-surface-3 rounded-xl p-4 text-xs text-slate-400 leading-relaxed whitespace-pre-line">
                {'1. Скачайте приложение Happ\n2. Откройте и нажмите «+»\n3. Выберите «Добавить подписку»\n4. Вставьте скопированную ссылку'}
              </div>
            </div>
          ) : data ? (
            <>
              {/* Step indicator */}
              <div className="flex items-center gap-3 justify-center">
                {[1, 2].map(s => (
                  <button key={s} onClick={() => setStep(s)} className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                      step === s
                        ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/30'
                        : step > s
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-surface-3 text-slate-500 border border-white/10'
                    }`}>
                      {step > s ? '✓' : s}
                    </div>
                    {s === 1 && <div className={`w-12 h-0.5 rounded-full transition-all ${step > 1 ? 'bg-emerald-500/40' : 'bg-white/8'}`} />}
                  </button>
                ))}
              </div>

              {/* Platform badge */}
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-3 border border-white/8 text-xs text-slate-400">
                  {PLATFORM_ICONS[data.platform] ?? '💻'} {PLATFORM_LABELS[data.platform] ?? data.platform}
                </span>
              </div>

              {step === 1 ? (
                /* ==================== STEP 1: DOWNLOAD ==================== */
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-brand-600/30 to-purple-600/30 border border-brand-500/20 flex items-center justify-center mb-4">
                      <span className="text-4xl">📲</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-1">{data.step1.title}</h3>
                    <p className="text-sm text-slate-400">
                      Установите <span className="text-white font-semibold">{data.step1.app_name}</span> на ваше устройство
                    </p>
                  </div>

                  <a
                    href={data.step1.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-semibold text-sm transition-all shadow-lg shadow-brand-600/25 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Скачать {data.step1.app_name}
                  </a>

                  <button onClick={() => setStep(2)}
                    className="w-full py-3 rounded-xl bg-surface-3 border border-white/10 text-sm font-medium text-slate-300 hover:text-white hover:border-white/20 transition-all">
                    Уже установлено → Далее
                  </button>
                </div>
              ) : (
                /* ==================== STEP 2: CONNECT ==================== */
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-emerald-600/30 to-brand-600/30 border border-emerald-500/20 flex items-center justify-center mb-4">
                      <span className="text-4xl">🔗</span>
                    </div>
                    <h3 className="text-lg font-bold text-white mb-1">{data.step2.title}</h3>
                    <p className="text-sm text-slate-400">
                      Нажмите кнопку ниже — подписка добавится автоматически
                    </p>
                  </div>

                  <a
                    href={data.step2.deeplink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-emerald-600 to-brand-600 hover:from-emerald-500 hover:to-brand-500 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Подключить
                  </a>

                  {/* QR code */}
                  {data.step2.qr_code && (
                    <div className="text-center">
                      <p className="text-xs text-slate-500 mb-3">Или отсканируйте QR-код</p>
                      <div className="inline-block p-3 bg-white rounded-xl">
                        <img src={data.step2.qr_code} alt="QR" className="w-40 h-40" />
                      </div>
                    </div>
                  )}

                  {/* Copy link */}
                  <CopyBtn text={data.step2.copy_link} label="Скопировать ссылку подписки" />

                  {/* Manual instructions */}
                  <details className="group">
                    <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300 transition-colors text-center">
                      Не получается? Ручная настройка
                    </summary>
                    <div className="mt-3 bg-surface-3 rounded-xl p-4 text-xs text-slate-400 leading-relaxed whitespace-pre-line">
                      {data.fallback.instruction}
                    </div>
                  </details>

                  <button onClick={() => setStep(1)}
                    className="w-full py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    ← Назад к скачиванию
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
