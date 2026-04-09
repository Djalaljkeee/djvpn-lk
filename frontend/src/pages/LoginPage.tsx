import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { loginWithPassword, loginWithTelegram } from '../api/auth'

declare global {
  interface Window {
    onTelegramAuth?: (user: object) => void
    TELEGRAM_BOT_USERNAME?: string
  }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const [tab, setTab] = useState<'telegram' | 'password'>('telegram')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const tgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthenticated()) navigate('/', { replace: true })
  }, [])

  // Инжектим Telegram Login Widget
  useEffect(() => {
    if (tab !== 'telegram' || !tgRef.current) return
    tgRef.current.innerHTML = ''

    window.onTelegramAuth = async (tgUser) => {
      setLoading(true)
      setError('')
      try {
        const { token, user } = await loginWithTelegram(tgUser)
        setAuth(token, user)
        navigate('/')
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Ошибка авторизации через Telegram')
      } finally {
        setLoading(false)
      }
    }

    const botUsername = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'your_bot'
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgRef.current.appendChild(script)

    return () => { window.onTelegramAuth = undefined }
  }, [tab])

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { token, user } = await loginWithPassword(login, password)
      setAuth(token, user)
      navigate('/')
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Неверный логин или пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 relative overflow-hidden px-4">
      {/* Ambient glows */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand-600/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-purple-700/6 rounded-full blur-3xl pointer-events-none" />

      {/* Grid */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(110,142,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(110,142,255,0.4) 1px, transparent 1px)',
          backgroundSize: '60px 60px'
        }}
      />

      <div className="w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 mb-4 shadow-lg shadow-brand-600/30">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 01.25 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.5-.765-4.822-2.079-6.75" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Личный кабинет</h1>
          <p className="text-slate-500 mt-1 text-sm">Войдите для управления услугами</p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-6 glow-blue">
          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-surface-2 rounded-xl mb-6">
            {([
              { key: 'telegram', label: 'Telegram' },
              { key: 'password', label: 'Логин / Пароль' }
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setError('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  tab === key
                    ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Telegram tab */}
          {tab === 'telegram' && (
            <div className="flex flex-col items-center py-4 gap-4 animate-fade-in">
              <p className="text-sm text-slate-400 text-center">
                Нажмите кнопку ниже для входа через Telegram
              </p>
              <div ref={tgRef} className="flex justify-center" />
              {loading && (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  Авторизация...
                </div>
              )}
            </div>
          )}

          {/* Password tab */}
          {tab === 'password' && (
            <form onSubmit={handlePasswordLogin} className="space-y-4 animate-fade-in">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Логин</label>
                <input
                  type="text"
                  value={login}
                  onChange={e => setLogin(e.target.value)}
                  placeholder="your_login"
                  required
                  className="w-full bg-surface-3 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-4 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Пароль</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-surface-3 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-4 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-600/20"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Вход...
                  </span>
                ) : 'Войти'}
              </button>
            </form>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 animate-fade-in">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
