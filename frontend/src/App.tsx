import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { ToastProvider } from './components/Toast'
import { useEffect, useState } from 'react'
import { loginWithWebApp } from './api/auth'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ServicesPage from './pages/ServicesPage'
import PaymentsPage from './pages/PaymentsPage'
import ReferralsPage from './pages/ReferralsPage'
import Layout from './components/Layout'

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string
        ready: () => void
        expand: () => void
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
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const tgWebApp = window.Telegram?.WebApp
    const initData = tgWebApp?.initData

    if (!initData || isAuthenticated()) {
      setChecking(false)
      return
    }

    // Работаем внутри Telegram Mini App — авторизуемся автоматически
    tgWebApp?.ready()
    tgWebApp?.expand()

    loginWithWebApp(initData)
      .then(({ token, user }) => {
        setAuth(token, user)
        navigate('/', { replace: true })
      })
      .catch(() => {
        // Fallback на обычную страницу входа
      })
      .finally(() => setChecking(false))
  }, [])

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
  return (
    <ToastProvider>
      <TelegramWebAppGate>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="referrals" element={<ReferralsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TelegramWebAppGate>
    </ToastProvider>
  )
}
