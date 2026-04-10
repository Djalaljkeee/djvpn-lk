import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { loginWithPassword, loginWithTelegram, registerWithPassword } from '../api/auth'
import { fetchConfig } from '../api/services'

declare global {
  interface Window { onTelegramAuth?: (user: object) => void }
}

type Mode = 'login' | 'register'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const [mode,       setMode]       = useState<Mode>('login')
  const [login,      setLogin]      = useState('')
  const [password,   setPassword]   = useState('')
  const [name,       setName]       = useState('')
  const [confirmPw,  setConfirmPw]  = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [botUsername, setBotUsername] = useState('')
  const tgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthenticated()) navigate('/', { replace: true })
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!botUsername || !tgRef.current) return
    tgRef.current.innerHTML = ''
    window.onTelegramAuth = async (tgUser) => {
      setLoading(true); setError('')
      try {
        const { token, user } = await loginWithTelegram(tgUser)
        setAuth(token, user); navigate('/')
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Ошибка авторизации через Telegram')
      } finally { setLoading(false) }
    }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgRef.current.appendChild(script)
    return () => { window.onTelegramAuth = undefined }
  }, [botUsername])

  const switchMode = (m: Mode) => { setMode(m); setError(''); setLogin(''); setPassword(''); setName(''); setConfirmPw('') }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'register' && password !== confirmPw) { setError('Пароли не совпадают'); return }
    setLoading(true); setError('')
    try {
      const { token, user } = mode === 'login'
        ? await loginWithPassword(login, password)
        : await registerWithPassword(login, password, name || undefined)
      setAuth(token, user); navigate('/')
    } catch (e: any) {
      setError(e?.response?.data?.detail || (mode === 'login' ? 'Неверный логин или пароль' : 'Ошибка регистрации'))
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-0 px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-brand-600/8 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-purple-700/6 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-purple-600 mb-4 shadow-xl shadow-brand-600/30">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.955 11.955 0 01.25 12c0 6.627 5.373 12 12 12s12-5.373 12-12c0-2.5-.765-4.822-2.079-6.75" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {mode === 'login' ? 'Добро пожаловать!' : 'Создать аккаунт'}
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            {mode === 'login' ? 'Войдите в свой аккаунт' : 'Зарегистрируйтесь для доступа'}
          </p>
        </div>

        {/* Card */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Name field — only for registration */}
            {mode === 'register' && (
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
                <input
                  type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Имя (необязательно)"
                  className="w-full bg-surface-3 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>
            )}

            {/* Login field */}
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <input
                type="text" value={login} onChange={e => setLogin(e.target.value)}
                placeholder="Логин"
                required
                className="w-full bg-surface-3 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 transition-all"
              />
            </div>

            {/* Password field */}
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Пароль"
                required
                className="w-full bg-surface-3 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 transition-all"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPw
                  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                }
              </button>
            </div>

            {/* Confirm password — only for registration */}
            {mode === 'register' && (
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <input
                  type={showPw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                  placeholder="Повторите пароль"
                  required
                  className="w-full bg-surface-3 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50 transition-all"
                />
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit" disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-600 to-purple-600 hover:from-brand-500 hover:to-purple-500 text-white font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-brand-600/25 flex items-center justify-center gap-2 mt-1"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                  {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                </>
              )}
            </button>
          </form>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400 animate-fade-in">
              {error}
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/8" />
            <span className="text-xs text-slate-600">или</span>
            <div className="flex-1 h-px bg-white/8" />
          </div>

          {/* Telegram button */}
          {botUsername ? (
            <div ref={tgRef} className="flex justify-center" />
          ) : (
            <div className="h-10 bg-surface-3 rounded-xl animate-pulse" />
          )}
        </div>

        {/* Register / Login toggle */}
        <p className="text-center text-sm text-slate-500 mt-5">
          {mode === 'login' ? (
            <>
              Нет аккаунта?{' '}
              <button onClick={() => switchMode('register')} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                Зарегистрируйтесь
              </button>
            </>
          ) : (
            <>
              Уже есть аккаунт?{' '}
              <button onClick={() => switchMode('login')} className="text-brand-400 hover:text-brand-300 font-medium transition-colors">
                Войти
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
