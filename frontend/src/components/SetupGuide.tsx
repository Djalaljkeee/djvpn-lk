import { useState } from 'react'

type Platform = 'ios' | 'android' | 'windows' | 'macos'

interface AppEntry {
  name: string
  desc: string
  store: string
  scheme: string   // {url} = encodeURIComponent(subUrl), {base64} = btoa(subUrl)
  free: boolean
  recommended?: boolean
}

const APPS: Record<Platform, AppEntry[]> = {
  ios: [
    {
      name: 'Hiddify',
      desc: 'Бесплатно · Рекомендуем',
      store: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532',
      scheme: 'hiddify://import/{url}',
      free: true, recommended: true,
    },
    {
      name: 'Streisand',
      desc: 'Бесплатно',
      store: 'https://apps.apple.com/app/streisand/id6450534064',
      scheme: 'streisand://import/sub?url={url}',
      free: true,
    },
    {
      name: 'Shadowrocket',
      desc: 'Платно · $2.99',
      store: 'https://apps.apple.com/app/shadowrocket/id932747118',
      scheme: 'shadowrocket://add/sub://{base64}',
      free: false,
    },
  ],
  android: [
    {
      name: 'Hiddify',
      desc: 'Бесплатно · Рекомендуем',
      store: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
      scheme: 'hiddify://import/{url}',
      free: true, recommended: true,
    },
    {
      name: 'v2rayNG',
      desc: 'Бесплатно',
      store: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
      scheme: 'v2rayng://install-sub?url={url}',
      free: true,
    },
  ],
  windows: [
    {
      name: 'Hiddify',
      desc: 'Бесплатно · Рекомендуем',
      store: 'https://github.com/hiddify/hiddify-app/releases/latest',
      scheme: 'hiddify://import/{url}',
      free: true, recommended: true,
    },
    {
      name: 'Clash Verge Rev',
      desc: 'Бесплатно',
      store: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest',
      scheme: 'clash://install-config?url={url}',
      free: true,
    },
  ],
  macos: [
    {
      name: 'Hiddify',
      desc: 'Бесплатно · Рекомендуем',
      store: 'https://apps.apple.com/app/hiddify-proxy-vpn/id6596777532',
      scheme: 'hiddify://import/{url}',
      free: true, recommended: true,
    },
    {
      name: 'Clash Verge Rev',
      desc: 'Бесплатно',
      store: 'https://github.com/clash-verge-rev/clash-verge-rev/releases/latest',
      scheme: 'clash://install-config?url={url}',
      free: true,
    },
  ],
}

const PLATFORM_LABELS: Record<Platform, string> = {
  ios: 'iOS',
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  const pl = navigator.platform || ''
  if (/iPad|iPhone|iPod/.test(ua) || (pl === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Mac/.test(pl)) return 'macos'
  return 'windows'
}

function buildDeepLink(scheme: string, subUrl: string): string {
  if (scheme.includes('{base64}')) return scheme.replace('{base64}', btoa(subUrl))
  return scheme.replace('{url}', encodeURIComponent(subUrl))
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-brand-600/15 text-brand-400 hover:bg-brand-600/25 transition-colors whitespace-nowrap"
    >
      {copied ? '✓ Скопировано' : 'Скопировать'}
    </button>
  )
}

export default function SetupGuide({ subUrl, onClose }: { subUrl: string; onClose: () => void }) {
  const [platform, setPlatform] = useState<Platform>(detectPlatform)

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

        <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Platform tabs */}
          <div className="flex gap-1 p-1 bg-surface-3 rounded-xl">
            {(Object.keys(APPS) as Platform[]).map(p => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  platform === p ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}>
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>

          {/* App list */}
          <div className="space-y-2.5">
            {APPS[platform].map(app => (
              <div key={app.name} className={`rounded-xl border p-4 space-y-3 ${
                app.recommended ? 'bg-brand-600/8 border-brand-500/25' : 'bg-surface-3 border-white/8'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{app.name}</span>
                      {app.recommended && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-brand-600/30 text-brand-300 border border-brand-500/30">
                          Рекомендуем
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 mt-0.5 block">{app.desc}</span>
                  </div>
                  <a href={app.store} target="_blank" rel="noopener noreferrer"
                    className="flex-shrink-0 text-xs px-3 py-1.5 rounded-lg bg-surface-2 border border-white/10 text-slate-300 hover:text-white hover:border-white/20 transition-all whitespace-nowrap">
                    Скачать
                  </a>
                </div>
                <a
                  href={buildDeepLink(app.scheme, subUrl)}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Добавить в {app.name}
                </a>
              </div>
            ))}
          </div>

          {/* Subscription URL */}
          <div className="pt-1">
            <p className="text-xs text-slate-500 mb-1.5 font-medium">Ссылка подписки</p>
            <div className="flex items-center gap-2 bg-surface-3 border border-white/8 rounded-xl px-3 py-2.5">
              <code className="flex-1 text-xs text-brand-300 font-mono truncate min-w-0">{subUrl}</code>
              <CopyButton text={subUrl} />
            </div>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Используйте эту ссылку для ручной настройки в любом VPN-клиенте с поддержкой подписок.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
