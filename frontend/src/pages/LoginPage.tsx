import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import {
  loginWithPassword,
  loginWithTelegram,
  registerWithPassword,
  fetchCaptcha,
  type CaptchaData,
} from '../api/auth'
import { verifyEmailToken, requestEmailVerification, fetchProfile } from '../api/user'
import { fetchConfig } from '../api/services'
import { BrandLogo } from '../components/BrandLogo'

declare global {
  interface Window { onTelegramAuth?: (user: object) => void }
}

type Mode = 'login' | 'register' | 'verify-email'

export default function LoginPage() {
  const navigate = useNavigate()
  const { setAuth, setUser, isAuthenticated } = useAuthStore()
  const [mode, setMode] = useState<Mode>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [botUsername, setBotUsername] = useState('')

  // Captcha state
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null)
  const [captchaCode, setCaptchaCode] = useState('')
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [captchaAvailable, setCaptchaAvailable] = useState(true)

  // Email verification step state
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyResending, setVerifyResending] = useState(false)
  const [verifySuccess, setVerifySuccess] = useState('')

  const tgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAuthenticated()) navigate('/', { replace: true })
    fetchConfig().then(cfg => setBotUsername(cfg.telegram_bot_username)).catch(() => {})
  }, [])

  const loadCaptcha = useCallback(async () => {
    setCaptchaLoading(true)
    try {
      const data = await fetchCaptcha()
      setCaptcha(data)
      setCaptchaCode('')
      setCaptchaAvailable(true)
    } catch {
      // Если SHM не отдал капчу — регистрация работает без неё
      setCaptcha(null)
      setCaptchaAvailable(false)
    } finally {
      setCaptchaLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'register') {
      loadCaptcha()
    } else {
      setCaptcha(null)
      setCaptchaCode('')
    }
  }, [mode, loadCaptcha])

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
    setVerifySuccess('')
    if (nextMode !== 'verify-email') {
      setLogin('')
      setPassword('')
      setName('')
      setEmail('')
      setConfirmPw('')
      setVerifyEmail('')
      setVerifyCode('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim().toLowerCase()
    if (mode === 'register') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
        setError('Введите корректный email')
        return
      }
      if (password !== confirmPw) {
        setError('Пароли не совпадают')
        return
      }
      if (captchaAvailable && !captchaCode.trim()) {
        setError('Введите текст с картинки')
        return
      }
    }
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        const { token, user } = await loginWithPassword(login, password)
        setAuth(token, user)
        navigate('/')
      } else {
        const result = await registerWithPassword({
          login: trimmedEmail,
          password,
          name: name || undefined,
          email: trimmedEmail,
          captcha_token: captcha?.token,
          captcha_code: captchaAvailable ? captchaCode : undefined,
        })
        setAuth(result.token, result.user)
        if (result.email_verification_sent) {
          setVerifyEmail(trimmedEmail)
          setVerifyCode('')
          setMode('verify-email')
        } else {
          navigate('/')
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || (mode === 'login' ? 'Неверный логин или пароль' : 'Ошибка регистрации'))
      if (mode === 'register') loadCaptcha()  // обновляем капчу после ошибки
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = verifyCode.trim()
    if (!code) {
      setError('Введите код из письма')
      return
    }
    setLoading(true)
    setError('')
    try {
      await verifyEmailToken(code)
      // Обновляем профиль в сторе
      try {
        const fresh = await fetchProfile()
        setUser(fresh)
      } catch {}
      setVerifySuccess('Email успешно подтверждён')
      setTimeout(() => navigate('/'), 800)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Неверный код подтверждения')
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerify = async () => {
    setVerifyResending(true)
    setError('')
    try {
      await requestEmailVerification()
      setVerifySuccess('Письмо с кодом отправлено повторно')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Не удалось отправить письмо')
    } finally {
      setVerifyResending(false)
    }
  }

  const skipVerify = () => {
    // Пользователь всё равно авторизован, просто перейдем на главную —
    // напоминание висит в профиле.
    navigate('/')
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
              {mode !== 'verify-email' && (
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
              )}

              {mode === 'verify-email' ? (
                <EmailVerifyBlock
                  email={verifyEmail}
                  code={verifyCode}
                  setCode={setVerifyCode}
                  onSubmit={handleVerifyEmail}
                  onResend={handleResendVerify}
                  onSkip={skipVerify}
                  loading={loading}
                  resending={verifyResending}
                  error={error}
                  success={verifySuccess}
                />
              ) : (
                <>
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

                    {mode === 'login' ? (
                      <Field label="Логин или email">
                        <input
                          type="text"
                          value={login}
                          onChange={e => setLogin(e.target.value)}
                          placeholder="Введите логин или email"
                          required
                          autoComplete="username"
                          className={fieldClass}
                        />
                      </Field>
                    ) : (
                      <Field label="Email">
                        <input
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          required
                          className={fieldClass}
                        />
                        <span className="block text-xs text-slate-400">
                          Email будет вашим логином. Подтвердим кодом из письма.
                        </span>
                      </Field>
                    )}

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

                    {mode === 'register' && captchaAvailable && (
                      <Field label="Проверка, что вы человек">
                        <div className="flex items-center gap-3">
                          <div className="flex h-[52px] w-36 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
                            {captcha ? (
                              <img
                                src={captcha.image_url || captcha.image}
                                alt="captcha"
                                className="h-full w-full object-contain"
                                onError={(ev) => {
                                  // Если прямой URL не сработал — пробуем data-URI
                                  const img = ev.currentTarget
                                  if (captcha.image_url && img.src !== captcha.image) {
                                    img.src = captcha.image
                                  }
                                }}
                              />
                            ) : (
                              <div className={`h-full w-full animate-pulse bg-white/40 ${captchaLoading ? '' : 'opacity-40'}`} />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={loadCaptcha}
                            disabled={captchaLoading}
                            title="Обновить капчу"
                            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-60"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992V4.355m-.372 4.993a8.25 8.25 0 11-2.41-4.84L20.015 7M3.75 14.25v-4.5h4.5m-.06 4.74a8.25 8.25 0 002.41 4.84L4.5 21" />
                            </svg>
                          </button>
                          <input
                            type="text"
                            value={captchaCode}
                            onChange={e => setCaptchaCode(e.target.value)}
                            placeholder="Код"
                            autoComplete="off"
                            className={`${fieldClass} flex-1`}
                            required
                          />
                        </div>
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
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function EmailVerifyBlock({
  email,
  code,
  setCode,
  onSubmit,
  onResend,
  onSkip,
  loading,
  resending,
  error,
  success,
}: {
  email: string
  code: string
  setCode: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  onResend: () => void
  onSkip: () => void
  loading: boolean
  resending: boolean
  error: string
  success: string
}) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-white">Подтверждение email</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Мы отправили код на <span className="font-medium text-white">{email}</span>. Проверьте входящие (в том числе спам) и введите код ниже.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Код из письма">
          <input
            type="text"
            inputMode="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Например, ABC123"
            autoFocus
            required
            className={fieldClass}
          />
        </Field>
        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:brightness-110 disabled:opacity-60"
        >
          {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          Подтвердить
        </button>
      </form>
      {success && (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {success}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-2 text-center text-sm text-slate-300">
        <button
          type="button"
          onClick={onResend}
          disabled={resending}
          className="font-medium text-fuchsia-200 hover:text-white disabled:opacity-60"
        >
          {resending ? 'Отправка…' : 'Отправить код повторно'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-slate-400 hover:text-white"
        >
          Пропустить (подтвердить позже в профиле)
        </button>
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
