import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { useToast } from '../components/Toast'
import { changePassword } from '../api/user'

/**
 * Standalone-страница смены пароля. Открывается по deep-ссылке из
 * Telegram-бота: `https://<домен>/change-password`.
 *
 * Внутри Telegram Mini App `TelegramWebAppGate` уже авторизует пользователя
 * по initData, поэтому форма работает без дополнительного шага логина.
 * Снаружи Telegram анонимный пользователь будет отправлен на /login через
 * `PrivateRoute`.
 */
export default function ChangePasswordPage() {
  const navigate = useNavigate()
  const { show } = useToast()
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [success, setSuccess] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Защитный вызов: gate уже зовёт ready/expand, но страница может быть
    // открыта прямой ссылкой ещё до того, как gate смонтирован.
    const tg = window.Telegram?.WebApp
    tg?.ready?.()
    tg?.expand?.()
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  const handleSubmit = async () => {
    if (pw1.length < 6) {
      show('Минимум 6 символов', 'error')
      return
    }
    if (pw1 !== pw2) {
      show('Пароли не совпадают', 'error')
      return
    }
    setBusy(true)
    try {
      await changePassword(pw1)
      setSuccess(true)
      show('Пароль изменён', 'success')
      closeTimerRef.current = setTimeout(() => {
        const tgClose = window.Telegram?.WebApp?.close
        if (typeof tgClose === 'function') {
          tgClose()
          return
        }
        navigate('/profile', { replace: true })
      }, 1200)
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Не удалось сменить пароль'
      show(typeof msg === 'string' ? msg : 'Не удалось сменить пароль', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-surface-0 px-4 py-6 text-white">
      <div className="absolute inset-x-0 top-0 h-[38vh] bg-gradient-to-b from-brand-300/25 to-transparent blur-3xl" />
      <div className="absolute left-[-8%] top-[22%] h-72 w-72 rounded-full bg-brand-700/25 blur-3xl" />
      <div className="absolute bottom-[-8%] right-[-5%] h-80 w-80 rounded-full bg-brand-500/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col">
        <button
          onClick={() => navigate(-1)}
          className="self-start rounded-xl bg-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/20 transition-colors"
        >
          ← Назад
        </button>

        <div className="mt-6 flex flex-col items-center text-center">
          <BrandLogo size={64} />
          <h1 className="mt-4 text-2xl font-semibold">Смена пароля</h1>
          <p className="mt-2 text-sm text-slate-300">
            Задайте новый пароль для входа в личный кабинет.
          </p>
        </div>

        {success ? (
          <div className="mt-8 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20">
              <svg className="h-6 w-6 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div className="mt-3 text-base font-medium text-emerald-200">Пароль изменён</div>
            <div className="mt-1 text-xs text-slate-300">Окно закроется автоматически…</div>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={pw1}
              onChange={e => setPw1(e.target.value)}
              placeholder="Новый пароль"
              disabled={busy}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={pw2}
              onChange={e => setPw2(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !busy) handleSubmit()
              }}
              placeholder="Повторите пароль"
              disabled={busy}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60"
            />
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="w-full rounded-2xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-500 transition-colors disabled:opacity-60"
            >
              {busy ? 'Сохранение…' : 'Сохранить'}
            </button>
            <p className="pt-1 text-center text-xs text-slate-400">
              Минимум 6 символов. Старый пароль не требуется.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
