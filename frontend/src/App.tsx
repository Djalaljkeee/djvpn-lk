import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useDashboardStore } from './store/dashboardStore'
import { ToastProvider } from './components/Toast'
import { useEffect, useState } from 'react'
import { loginWithWebApp } from './api/auth'
import { captureRefIdFromUrl, clearRefId, getRefId } from './utils/referral'
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
  }
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated())
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

/** Автоматическая авторизация через Telegram Mini App */
function TelegramWebAppGate({ children }: { children: React.ReactNode }) {
  const { setAuth, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  // Внутри Telegram WebApp всегда обновляем shm_session, даже если в
  // localStorage лежит старый токен — иначе /api/dashboard ходит со
  // stale-сессией и возвращает пустой profile/services.
  const [checking, setChecking] = useState(
    () => Boolean(window.Telegram?.WebApp?.initData),
  )

  useEffect(() => {
    const tgWebApp = window.Telegram?.WebApp
    const initData = tgWebApp?.initData

    if (!initData) {
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
        clearRefId()
        // Кеш дашборда мог быть привязан к прошлой shm_session —
        // сбрасываем, чтобы свежий запрос ушёл с обновлёнными credentials.
        useDashboardStore.getState().reset()
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TelegramWebAppGate>
    </ToastProvider>
  )
}
