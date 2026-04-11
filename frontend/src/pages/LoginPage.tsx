import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { loginWithPassword, loginWithTelegram, registerWithPassword } from '../api/auth'
import { fetchConfig } from '../api/services'
import { BrandLogo } from '../components/BrandLogo'

declare global {
  interface Window { onTelegramAuth?: (user: object) => void }
}

type Mode = 'login' | 'register'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth, isAuthenticated } = useAuthStore()
  const [mode, setMode] = useState<Mode>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
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
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '14')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    script.async = true
    tgRef.current.appendChild(script)
    return () => {
      window.onTelegramAuth = undefined
      if (tgRef.current) tgRef.current.innerHTML = ''
    }
  }, [botUsername])

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError('')
    setLogin('')
    setPassword('')
    setName('')
    setConfirmPw('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'register' && password !== confirmPw) {
      setError('Пароли не совпадают')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { token, user } = mode === 'login'
        ? await loginWithPassword(login, password)
        : await registerWithPassword(login, password, name || undefined)
      setAuth(token, user)
      navigate('/')
    } catch (e: any) {
      setError(e?.response?.data?.detail || (mode === 'login' ? 'Неверный логин или пароль' : 'Ошибка регистрации'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6">
      <div className="absolute inset-x-0 top-0 h-[38vh] bg-gradient-to-b from-brand-300/25 to-transparent blur-3xl" />
      <div className="absolute left-[-8%] top-[22%] h-72 w-72 rounded-full bg-brand-700/25 blur-3xl" />
      <div className="absolute bottom-[-8%] right-[-5%] h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="brand-panel hidden rounded-[2rem] p-8 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <BrandLogo size={96} showWordmark />
              <div className="max-w-xl">
                <div className="text-sm uppercase tracking-[0.4em] text-fuchsia-100/70">DJ VPN cabinet</div>
                <h1 className="mt-4 text-5xl font-bold leading-tight text-white">
                  Управление VPN без лишнего шума и сложных экранов.
                </h1>
                <p className="mt-4 text-base leading-7 text-slate-200">
                  Быстрый вход, понятные тарифы, баланс, промокоды и настройка подключения в одном интерфейсе.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { title: 'Mini App', text: 'Автовход внутри Telegram' },
                { title: 'Тарифы', text: 'Понятные цены и статусы' },
                { title: 'Deeplink', text: 'Подключение в пару касаний' },
              ].map(item => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-200">{item.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mx-auto w-full max-w-md animate-slide-up">
            <div className="glass rounded-[2rem] p-5 sm:p-7">
              <div className="mb-6 flex items-center justify-between gap-3">
                <BrandLogo size={64} />
                <div className="rounded-2xl border border-white/10 bg-white/5 p-1">
                  {([
                    { key: 'login', label: 'Вход' },
                    { key: 'register', label: 'Регистрация' },
                  ] as const).map(item => (
                    <button
                      key={item.key}
                      onClick={() => switchMode(item.key)}
                      className={`rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                        mode === item.key ? 'bg-brand-500/25 text-white' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <h2 className="text-2xl font-bold text-white">
                  {mode === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  {mode === 'login'
                    ? 'Войдите по логину и паролю или используйте Telegram.'
                    : 'Заполните форму, чтобы создать аккаунт и управлять услугами.'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === 'register' && (
                  <Field label="Имя" optional>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Ваше имя"
                      className={fieldClass}
                    />
                  </Field>
                )}

                <Field label="Логин">
                  <input
                    type="text"
                    value={login}
                    onChange={e => setLogin(e.target.value)}
                    placeholder="Введите логин"
                    required
                    className={fieldClass}
                  />
                </Field>

                <Field label="Пароль">
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Введите пароль"
                      required
                      className={`${fieldClass} pr-12`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-300 hover:text-white"
                    >
                      {showPw ? 'Скрыть' : 'Показать'}
                    </button>
                  </div>
                </Field>

                {mode === 'register' && (
                  <Field label="Повтор пароля">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={confirmPw}
                      onChange={e => setConfirmPw(e.target.value)}
                      placeholder="Повторите пароль"
                      required
                      className={fieldClass}
                    />
                  </Field>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:brightness-110 disabled:opacity-60"
                >
                  {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
                  {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
                </button>
              </form>

              {error && (
                <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              )}

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs uppercase tracking-[0.25em] text-slate-400">Telegram</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              {botUsername ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div ref={tgRef} className="flex justify-center" />
                </div>
              ) : (
                <div className="h-14 rounded-2xl bg-white/5 animate-pulse" />
              )}

              <p className="mt-5 text-center text-sm text-slate-300">
                {mode === 'login' ? (
                  <>
                    Нет аккаунта?{' '}
                    <button onClick={() => switchMode('register')} className="font-medium text-fuchsia-200 hover:text-white">
                      Зарегистрируйтесь
                    </button>
                  </>
                ) : (
                  <>
                    Уже есть аккаунт?{' '}
                    <button onClick={() => switchMode('login')} className="font-medium text-fuchsia-200 hover:text-white">
                      Войти
                    </button>
                  </>
                )}
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  optional = false,
  children,
}: {
  label: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-slate-200">
        {label}
        {optional && <span className="ml-1 text-slate-400">(необязательно)</span>}
      </span>
      {children}
    </label>
  )
}

const fieldClass =
  'w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-400 outline-none transition-all focus:border-brand-300/50 focus:bg-white/10'
