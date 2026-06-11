import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import {
  loginWithPassword,
  loginWithTelegram,
  registerWithPassword,
  requestPasswordReset,
  resetPassword,
  fetchCaptcha,
  type CaptchaData,
} from '../api/auth'
import { verifyEmailToken, requestEmailVerification, fetchProfile } from '../api/user'
import { fetchConfig } from '../api/services'
import { BrandLogo } from '../components/BrandLogo'
import { clearRefId, getRefId } from '../utils/referral'
import { getPhotoUrlFromTelegramUser } from '../utils/telegram'

declare global {
  interface Window { onTelegramAuth?: (user: object) => void }
}

type Mode = 'login' | 'register' | 'verify-email' | 'forgot' | 'reset-password'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setAuth, setUser, setTgPhotoUrl, isAuthenticated } = useAuthStore()
  const [mode, setMode] = useState<Mode>('login')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  // 152-ФЗ: согласия на обработку ПД и на договор оказания услуг — обе
  // галочки обязательны для регистрации.
  const [agreePersonalData, setAgreePersonalData] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
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

  // Password reset state
  const [resetValue, setResetValue] = useState('')   // email/login для запроса
  const [resetSent, setResetSent] = useState(false)
  const [resetToken, setResetToken] = useState('')   // токен из ссылки в письме
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [resetSuccess, setResetSuccess] = useState('')

  const tgRef = useRef<HTMLDivElement>(null)
  // Внутри Telegram WebApp авторизация идёт по initData (TelegramWebAppGate),
  // а Telegram Login Widget iframe-ит oauth.telegram.org, у которого CSP
  // frame-ancestors не допускает цепочку [lk.djvpn.ru, web.telegram.org] —
  // консоль засыпает Framing-ошибками, виджет всё равно не отрисовывается.
  // Если юзер уже в WebApp — скрываем виджет и показываем форму логин/пароль.
  const isInTelegramWebApp = Boolean(window.Telegram?.WebApp?.initData)

  useEffect(() => {
    // Ссылка для сброса пароля из письма ведёт на /login?token=… — ловим
    // токен и сразу показываем форму нового пароля. Авторедирект на «/»
    // в этом случае пропускаем (юзер мог быть авторизован в другой вкладке).
    const token = searchParams.get('token')
    if (token) {
      setResetToken(token)
      setMode('reset-password')
    } else if (isAuthenticated()) {
      navigate('/', { replace: true })
    }
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
    if (isInTelegramWebApp) return
    if (!botUsername || !tgRef.current) return
    tgRef.current.innerHTML = ''
    window.onTelegramAuth = async (tgUser) => {
      setLoading(true)
      setError('')
      try {
        const { user } = await loginWithTelegram(tgUser, getRefId() ?? undefined)
        setAuth(user)
        const photoUrl = getPhotoUrlFromTelegramUser(tgUser)
        if (photoUrl) setTgPhotoUrl(photoUrl)
        clearRefId()
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
  }, [botUsername, isInTelegramWebApp])

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode)
    setError('')
    setVerifySuccess('')
    setResetSent(false)
    setResetSuccess('')
    if (nextMode !== 'verify-email') {
      setLogin('')
      setPassword('')
      setName('')
      setEmail('')
      setConfirmPw('')
      setVerifyEmail('')
      setVerifyCode('')
      setAgreePersonalData(false)
      setAgreeTerms(false)
    }
    if (nextMode !== 'forgot') {
      setResetValue('')
    }
    if (nextMode !== 'reset-password') {
      setResetToken('')
      setNewPassword('')
      setConfirmNewPassword('')
      // Убираем ?token из URL, чтобы он не «прилипал» при возврате ко входу.
      if (searchParams.get('token')) navigate('/login', { replace: true })
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
      if (!agreePersonalData || !agreeTerms) {
        setError('Необходимо согласиться с обработкой персональных данных и условиями оказания услуг')
        return
      }
    }
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        const { user } = await loginWithPassword(login, password)
        setAuth(user)
        // Password-login приходит без Telegram-фотки — сбрасываем кеш
        // от предыдущего пользователя, иначе он «прилипнет» на новом аккаунте.
        setTgPhotoUrl(null)
        navigate('/')
      } else {
        const result = await registerWithPassword({
          login: trimmedEmail,
          password,
          name: name || undefined,
          email: trimmedEmail,
          captcha_code: captchaAvailable ? captchaCode : undefined,
          partner_id: getRefId() ?? undefined,
          agree_personal_data: agreePersonalData,
          agree_terms: agreeTerms,
        })
        setAuth(result.user)
        clearRefId()
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

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = resetValue.trim()
    if (!value) {
      setError('Введите email или логин')
      return
    }
    setLoading(true)
    setError('')
    try {
      await requestPasswordReset(value)
      // Нейтральное подтверждение: не раскрываем, существует ли аккаунт.
      setResetSent(true)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Не удалось отправить ссылку. Попробуйте позже.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newPassword) {
      setError('Введите новый пароль')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setError('Пароли не совпадают')
      return
    }
    setLoading(true)
    setError('')
    try {
      await resetPassword(resetToken, newPassword)
      setResetSuccess('Пароль обновлён. Сейчас откроем форму входа.')
      setTimeout(() => switchMode('login'), 1500)
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Не удалось изменить пароль')
    } finally {
      setLoading(false)
    }
  }

  const features = [
    {
      icon: <BoltIcon className="h-5 w-5" />,
      title: 'Высокая скорость',
      text: 'Серверы с запасом ресурсов для стриминга, звонков, игр и загрузок без ограничений.',
    },
    {
      icon: <ShieldIcon className="h-5 w-5" />,
      title: 'Надёжная работа',
      text: 'Резервирование узлов и постоянный мониторинг обеспечивают стабильное соединение 24/7.',
    },
    {
      icon: <PhoneIcon className="h-5 w-5" />,
      title: 'Подключение за минуту',
      text: 'Вход через Telegram, готовые конфигурации и простая настройка на любых устройствах.',
    },
  ]

  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-6">
      <div className="absolute inset-x-0 top-0 h-[38vh] bg-gradient-to-b from-brand-300/25 to-transparent blur-3xl" />
      <div className="absolute left-[-8%] top-[22%] h-72 w-72 rounded-full bg-brand-700/25 blur-3xl" />
      <div className="absolute bottom-[-8%] right-[-5%] h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col justify-center gap-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="brand-panel hidden rounded-[2rem] p-8 lg:flex lg:flex-col lg:justify-between">
            <div className="space-y-6">
              <BrandLogo size={72} showWordmark />

              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
                <BoltIcon className="h-4 w-4 text-fuchsia-200" />
                Работает в РФ · Без логов · Подключение за 1 минуту
              </div>

              <div className="max-w-xl">
                <h1 className="text-5xl font-bold leading-tight text-white">
                  VPN, который<br />
                  <span className="gradient-text">просто работает</span>
                </h1>
                <p className="mt-4 text-base leading-7 text-slate-200">
                  Получите стабильный доступ к нужным сайтам и сервисам через быстрые серверы
                  по всему миру. Управляйте подпиской, устройствами и подключениями в личном
                  кабинете или прямо через Telegram.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {features.map(item => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20 text-fuchsia-100">
                    {item.icon}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">{item.title}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-200">{item.text}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mx-auto w-full max-w-md animate-slide-up">
            <div className="glass rounded-[2rem] p-5 sm:p-7">
              {(mode === 'login' || mode === 'register') && (
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
              ) : mode === 'forgot' ? (
                <ForgotPasswordBlock
                  value={resetValue}
                  setValue={setResetValue}
                  onSubmit={handleForgotSubmit}
                  onBack={() => switchMode('login')}
                  loading={loading}
                  error={error}
                  sent={resetSent}
                />
              ) : mode === 'reset-password' ? (
                <ResetPasswordBlock
                  password={newPassword}
                  setPassword={setNewPassword}
                  confirm={confirmNewPassword}
                  setConfirm={setConfirmNewPassword}
                  showPw={showPw}
                  setShowPw={setShowPw}
                  onSubmit={handleResetSubmit}
                  onBack={() => switchMode('login')}
                  loading={loading}
                  error={error}
                  success={resetSuccess}
                />
              ) : (
                <>
                  <div className="mb-5">
                    <h2 className="text-2xl font-bold text-white">
                      {mode === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-slate-300">
                      {mode === 'login'
                        ? isInTelegramWebApp
                          ? 'Войдите по логину и паролю.'
                          : 'Войдите по логину и паролю или используйте Telegram.'
                        : 'Заполните форму, чтобы создать аккаунт и управлять услугами.'}
                    </p>
                  </div>

                  {!isInTelegramWebApp && (
                    <>
                      {botUsername ? (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                          <div ref={tgRef} className="flex justify-center" />
                        </div>
                      ) : (
                        <div className="h-14 rounded-2xl bg-white/5 animate-pulse" />
                      )}

                      <div className="my-5 flex items-center gap-3">
                        <div className="h-px flex-1 bg-white/10" />
                        <span className="text-xs uppercase tracking-[0.25em] text-slate-400">или</span>
                        <div className="h-px flex-1 bg-white/10" />
                      </div>
                    </>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-3">
                    {mode === 'register' && (
                      <Field label="Имя" optional>
                        <div className="relative">
                          <UserIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="Ваше имя"
                            className={`${fieldClass} pl-11`}
                          />
                        </div>
                      </Field>
                    )}

                    {mode === 'login' ? (
                      <Field label="Логин или email">
                        <div className="relative">
                          <UserIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={login}
                            onChange={e => setLogin(e.target.value)}
                            placeholder="Введите логин или email"
                            required
                            autoComplete="username"
                            className={`${fieldClass} pl-11`}
                          />
                        </div>
                      </Field>
                    ) : (
                      <Field label="Email">
                        <div className="relative">
                          <MailIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            required
                            className={`${fieldClass} pl-11`}
                          />
                        </div>
                        <span className="block text-xs text-slate-400">
                          Email будет вашим логином. Подтвердим кодом из письма.
                        </span>
                      </Field>
                    )}

                    <Field label="Пароль">
                      <div className="relative">
                        <LockIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type={showPw ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="Введите пароль"
                          required
                          className={`${fieldClass} pl-11 pr-24`}
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

                    {mode === 'login' && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => switchMode('forgot')}
                          className="text-xs font-medium text-slate-300 hover:text-white"
                        >
                          Забыли пароль?
                        </button>
                      </div>
                    )}

                    {mode === 'register' && (
                      <Field label="Повтор пароля">
                        <div className="relative">
                          <LockIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                          <input
                            type={showPw ? 'text' : 'password'}
                            value={confirmPw}
                            onChange={e => setConfirmPw(e.target.value)}
                            placeholder="Повторите пароль"
                            required
                            className={`${fieldClass} pl-11`}
                          />
                        </div>
                      </Field>
                    )}

                    {mode === 'register' && captchaAvailable && (
                      <Field label="Проверка, что вы человек">
                        <div className="flex items-center gap-3">
                          <div className="flex h-[52px] w-36 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white">
                            {captcha ? (
                              <img
                                src={captcha.image_url}
                                alt="captcha"
                                className="h-full w-full object-contain"
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

                    {mode === 'register' && (
                      <div className="space-y-2.5 pt-1">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={agreePersonalData}
                            onChange={e => setAgreePersonalData(e.target.checked)}
                            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-white/20 bg-white/5 accent-brand-500"
                          />
                          <span className="text-xs leading-relaxed text-slate-300">
                            Я даю согласие на обработку моих персональных данных в соответствии с{' '}
                            <a
                              href="/setup.html#privacy"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-300 hover:text-white underline"
                            >
                              Политикой конфиденциальности
                            </a>{' '}и Федеральным законом № 152-ФЗ.
                          </span>
                        </label>
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={agreeTerms}
                            onChange={e => setAgreeTerms(e.target.checked)}
                            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-white/20 bg-white/5 accent-brand-500"
                          />
                          <span className="text-xs leading-relaxed text-slate-300">
                            Я принимаю условия{' '}
                            <a
                              href="/setup.html#terms"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand-300 hover:text-white underline"
                            >
                              договора оказания услуг
                            </a>.
                          </span>
                        </label>
                      </div>
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

                  <p className="mt-5 text-center text-sm text-slate-300">
                    {mode === 'login' ? (
                      <>
                        Нет аккаунта?{' '}
                        <button onClick={() => switchMode('register')} className="font-medium text-fuchsia-200 hover:text-white">
                          Создайте его за минуту
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

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <ShieldIcon className="h-4 w-4" /> Шифрование AES-256
          </span>
          <span className="inline-flex items-center gap-2">
            <LockIcon className="h-4 w-4" /> Без логов
          </span>
          <span className="inline-flex items-center gap-2">
            <ChatIcon className="h-4 w-4" /> Поддержка в Telegram 24/7
          </span>
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
          Мы отправили код на <span className="font-medium text-white">{email}</span>. Введите его ниже, чтобы подтвердить почту.
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

      <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs leading-5 text-slate-300">
        <MailIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-fuchsia-200" />
        <span>Не нашли письмо? Проверьте папку «Спам» — код может попасть туда.</span>
      </div>

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

function ForgotPasswordBlock({
  value,
  setValue,
  onSubmit,
  onBack,
  loading,
  error,
  sent,
}: {
  value: string
  setValue: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  loading: boolean
  error: string
  sent: boolean
}) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-white">Восстановление пароля</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {sent
            ? 'Если аккаунт с такими данными существует, мы отправили на привязанную почту ссылку для сброса пароля. Проверьте входящие и папку «Спам».'
            : 'Укажите email или логин — пришлём ссылку для сброса пароля на привязанную почту.'}
        </p>
      </div>

      {!sent && (
        <form onSubmit={onSubmit} className="space-y-3">
          <Field label="Email или логин">
            <div className="relative">
              <MailIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="you@example.com или логин"
                autoFocus
                required
                className={`${fieldClass} pl-11`}
              />
            </div>
          </Field>
          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:brightness-110 disabled:opacity-60"
          >
            {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
            Отправить ссылку
          </button>
        </form>
      )}

      {sent && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          Письмо отправлено. Перейдите по ссылке из него, чтобы задать новый пароль.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-5 text-center text-sm text-slate-300">
        <button type="button" onClick={onBack} className="font-medium text-fuchsia-200 hover:text-white">
          Вернуться ко входу
        </button>
      </div>
    </div>
  )
}

function ResetPasswordBlock({
  password,
  setPassword,
  confirm,
  setConfirm,
  showPw,
  setShowPw,
  onSubmit,
  onBack,
  loading,
  error,
  success,
}: {
  password: string
  setPassword: (v: string) => void
  confirm: string
  setConfirm: (v: string) => void
  showPw: boolean
  setShowPw: (fn: (v: boolean) => boolean) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  loading: boolean
  error: string
  success: string
}) {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-white">Новый пароль</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Придумайте новый пароль для входа в личный кабинет.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Новый пароль">
          <div className="relative">
            <LockIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Введите новый пароль"
              autoComplete="new-password"
              autoFocus
              required
              className={`${fieldClass} pl-11 pr-24`}
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

        <Field label="Повтор пароля">
          <div className="relative">
            <LockIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Повторите новый пароль"
              autoComplete="new-password"
              required
              className={`${fieldClass} pl-11`}
            />
          </div>
        </Field>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 px-4 py-3.5 text-sm font-semibold text-white shadow-brand transition-all hover:brightness-110 disabled:opacity-60"
        >
          {loading && <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />}
          Сохранить пароль
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

      <div className="mt-5 text-center text-sm text-slate-300">
        <button type="button" onClick={onBack} className="font-medium text-fuchsia-200 hover:text-white">
          Вернуться ко входу
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

function BoltIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" />
    </svg>
  )
}

function ShieldIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7 3v5c0 4.6-3.1 7.7-7 9-3.9-1.3-7-4.4-7-9V6l7-3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
    </svg>
  )
}

function PhoneIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path strokeLinecap="round" d="M10.5 18.5h3" />
    </svg>
  )
}

function UserIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  )
}

function MailIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 7 8 6 8-6" />
    </svg>
  )
}

function LockIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  )
}

function ChatIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v10H8l-4 4V5Z" />
    </svg>
  )
}
