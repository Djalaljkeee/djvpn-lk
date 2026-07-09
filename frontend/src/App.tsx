import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useDashboardStore } from './store/dashboardStore'
import { ToastProvider } from './components/Toast'
import { useEffect, useState } from 'react'
import { loginWithWebApp } from './api/auth'
import { captureRefIdFromUrl, clearRefId, getRefId, saveRefId } from './utils/referral'
import { getPhotoUrlFromInitData } from './utils/telegram'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ServicesPage from './pages/ServicesPage'
import PaymentsPage from './pages/PaymentsPage'
import ReferralsPage from './pages/ReferralsPage'
import ProfilePage from './pages/ProfilePage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import Layout from './components/Layout'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
        close?: () => void
        colorScheme?: string
      }
    }
    // Telegram-клиент инжектит этот мост внутри Mini App WebView.
    TelegramWebviewProxy?: unknown
  }
}

// Запущены ли мы внутри Telegram Mini App? Определяем БЕЗ telegram-web-app.js
// (он грузится async и может ещё не подтянуться): Telegram кладёт launch-
// параметры в hash (#tgWebAppData=...) и инжектит TelegramWebviewProxy.
// Нужно, чтобы обычные браузерные пользователи (в т.ч. с заблокированным
// telegram.org) не ждали SDK и сразу видели интерфейс.
function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.hash.includes('tgWebAppData') ||
    Boolean(window.TelegramWebviewProxy) ||
    Boolean(window.Telegram?.WebApp?.initData)
  )
}

// Ждём готовности WebApp SDK (initData) до таймаута. Т.к. скрипт async, к
// моменту монтирования React он может быть ещё не загружен; при блокировке
// telegram.org — не загрузится вовсе, поэтому ограничиваем ожидание.
function waitForTelegramInitData(timeoutMs = 3000): Promise<string | null> {
  return new Promise(resolve => {
    const existing = window.Telegram?.WebApp?.initData
    if (existing) {
      resolve(existing)
      return
    }
    const start = Date.now()
    const timer = setInterval(() => {
      const initData = window.Telegram?.WebApp?.initData
      if (initData) {
        clearInterval(timer)
        resolve(initData)
      } else if (Date.now() - start >= timeoutMs) {
        clearInterval(timer)
        resolve(null)
      }
    }, 50)
  })
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated())
  return isAuthenticated ? <>{children}</> : <Navigate to={loginPath()} replace />
}

/** Путь на страницу входа с сохранением токена сброса пароля.
 *  Ссылка из письма может вести на любой путь (корень, /reset и т.п.);
 *  редиректы PrivateRoute/catch-all иначе «съели» бы ?token=, и форма
 *  нового пароля на /login не открылась бы. Пробрасываем токен дальше —
 *  тогда не важно, какой именно URL ЛК захардкожен в письме. */
function hasResetToken(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('token')
}

function loginPath(): string {
  if (typeof window === 'undefined') return '/login'
  const token = new URLSearchParams(window.location.search).get('token')
  return token ? `/login?token=${encodeURIComponent(token)}` : '/login'
}

/** Короткая реферальная ссылка: /r/:id или /r/ref-:id → захват + редирект на /.
 *  Принимаем оба формата (с префиксом ref- и без) — заказчик в макете
 *  использовал «ref-2», но цифровой id короче и работает так же. */
function ShortRefRedirect() {
  const { id } = useParams<{ id: string }>()
  useEffect(() => {
    if (id) {
      const raw = id.startsWith('ref-') ? id.slice(4) : id
      saveRefId(raw)
    }
  }, [id])
  return <Navigate to="/" replace />
}

/** Автоматическая авторизация через Telegram Mini App */
function TelegramWebAppGate({ children }: { children: React.ReactNode }) {
  const { setAuth, setTgPhotoUrl, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Внутри Telegram WebApp всегда обновляем shm_session, даже если в
  // localStorage лежит старый токен — иначе /api/dashboard ходит со
  // stale-сессией и возвращает пустой profile/services.
  // Начальное значение — по контексту запуска (hash/мост), НЕ по наличию SDK:
  // telegram-web-app.js грузится async и на монтировании может ещё отсутствовать.
  const [checking, setChecking] = useState(() => isTelegramMiniApp())

  useEffect(() => {
    // Не Mini App (обычный браузер, в т.ч. с заблокированным telegram.org) —
    // не ждём SDK, сразу показываем приложение.
    if (!isTelegramMiniApp()) {
      setChecking(false)
      return
    }

    let cancelled = false
    // SDK мог ещё не загрузиться (async) — ждём initData до таймаута.
    waitForTelegramInitData().then(initData => {
      if (cancelled) return
      const tgWebApp = window.Telegram?.WebApp

      if (!initData) {
        // SDK не подтянулся (например telegram.org заблокирован) — показываем
        // приложение как есть, PrivateRoute уведёт на /login.
        setChecking(false)
        return
      }

      // Работаем внутри Telegram Mini App — авторизуемся автоматически
      tgWebApp?.ready()
      tgWebApp?.expand()

      const wasAuthenticated = isAuthenticated()
      const partnerId = getRefId() ?? undefined
      loginWithWebApp(initData, partnerId)
        .then(({ user }) => {
          setAuth(user)
          // photo_url в SHM не приходит — достаём из initData один раз при
          // успешном auth, дальше сохраняется в localStorage вместе со стором.
          const photoUrl = getPhotoUrlFromInitData(initData)
          if (photoUrl) setTgPhotoUrl(photoUrl)
          clearRefId()
          // Кеш дашборда мог быть привязан к прошлой shm_session —
          // сбрасываем, чтобы свежий запрос ушёл с обновлёнными credentials.
          // Дополнительно дёргаем ensure({force:true}) — если на устройстве
          // лежит persist'нутый dashboard < 60s (TTL), reset() очищает память,
          // но без явного force последующий useDashboard.ensure() в Layout
          // мог увидеть свежий кеш до того, как мы его реально перезальём.
          // На iPhone WebView без этого fetchDashboard() не отстреливал свои
          // 11 параллельных запросов после auth, и кабинет оставался пустым.
          useDashboardStore.getState().reset()
          void useDashboardStore.getState().ensure({ force: true })
          // Только если пользователь пришёл на /login — отправляем на главную.
          // Любой deep-link (например /change-password) сохраняем как есть,
          // иначе ссылка из телеграм-бота «съедается» редиректом.
          if (!wasAuthenticated && location.pathname === '/login') {
            navigate('/', { replace: true })
          }
        })
        .catch(() => {
          // Авторизация не прошла — показываем приложение как есть
          // (PrivateRoute перенаправит на /login)
        })
        .finally(() => setChecking(false))
    })

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // намеренно без deps — запускаем один раз при монтировании

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Авторизация...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  // Захватываем ?ref=ID до маршрутизации/редиректов: значение переживёт
  // переход на /login и Telegram OAuth-редирект.
  captureRefIdFromUrl()
  return (
    <ToastProvider>
      <TelegramWebAppGate>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/r/:id" element={<ShortRefRedirect />} />
          <Route
            path="/change-password"
            element={<PrivateRoute><ChangePasswordPage /></PrivateRoute>}
          />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="referrals" element={<ReferralsPage />} />
          </Route>
          <Route
            path="*"
            element={<Navigate to={hasResetToken() ? loginPath() : '/'} replace />}
          />
        </Routes>
      </TelegramWebAppGate>
    </ToastProvider>
  )
}
