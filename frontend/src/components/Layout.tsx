import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useProfile } from '../hooks/useProfile'
import { BrandLogo } from './BrandLogo'
import LanguageSwitcher from './LanguageSwitcher'
import MaintenanceBanner from './MaintenanceBanner'
import NotificationBell from './NotificationBell'
import ParticleCanvas from './ParticleCanvas'

const navItems = [
  { to: '/',         labelKey: 'nav.home',     icon: HomeIcon,    end: true  },
  { to: '/services', labelKey: 'nav.services', icon: ServicesIcon, end: false },
  { to: '/payments', labelKey: 'nav.payments', icon: PayIcon,     end: false },
  { to: '/profile',  labelKey: 'nav.profile',  icon: ProfileIcon, end: false },
]

export default function Layout() {
  const user = useProfile()
  const { logout } = useAuthStore()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const balance = user?.balance ?? 0
  const displayName = user?.name || user?.login || '...'
  const avatar = displayName[0]?.toUpperCase() ?? 'D'

  return (
    <div className="min-h-screen flex flex-col bg-surface-0 text-white">
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden>
        {/* Global particle animation — fills entire viewport */}
        <ParticleCanvas className="opacity-60" />
        {/* Ambient glow blobs */}
        <div className="absolute -top-24 left-[-8%] h-[22rem] w-[22rem] rounded-full bg-brand-300/15 blur-3xl" />
        <div className="absolute top-[15%] right-[-5%] h-[20rem] w-[20rem] rounded-full bg-brand-500/12 blur-3xl" />
        <div className="absolute bottom-[-8%] left-[20%] h-[18rem] w-[18rem] rounded-full bg-brand-700/12 blur-3xl" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/10 bg-[rgba(26,9,35,0.72)] backdrop-blur-2xl">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-4 min-w-0">
            <BrandLogo size={48} showWordmark className="min-w-0" />
          </div>

          <nav className="hidden md:flex items-center gap-1 rounded-2xl bg-white/5 p-1">
            {navItems.map(({ to, labelKey, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-brand-500/25 text-white shadow-brand'
                      : 'text-slate-300 hover:bg-white/8 hover:text-white'
                  }`
                }
              >
                <Icon className="h-4 w-4" />
                {t(labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="hidden sm:flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-mono text-fuchsia-100">{balance.toFixed(2)} ₽</span>
            </div>

            <NotificationBell />

            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-2.5 py-2 hover:bg-white/10 transition-colors"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-700 text-sm font-bold text-white">
                  {avatar}
                </div>
                <div className="hidden sm:block text-left">
                  <div className="max-w-[120px] truncate text-sm text-white">{displayName}</div>
                  <div className="text-xs text-slate-300">{user?.login || t('layout.profile')}</div>
                </div>
                <svg className="h-4 w-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-white/10 bg-[rgba(31,12,45,0.96)] p-2 shadow-2xl backdrop-blur-2xl animate-fade-in">
                  <div className="rounded-xl bg-white/5 px-3 py-3">
                    <div className="text-xs text-slate-300">{t('layout.balance')}</div>
                    <div className="mt-1 text-lg font-mono text-white">{balance.toFixed(2)} ₽</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                    <span className="text-xs text-slate-300">{t('common.language')}</span>
                    <LanguageSwitcher />
                  </div>
                  <button
                    onClick={handleLogout}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    {t('layout.logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <MaintenanceBanner />

      <main className="relative z-10 mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-28 md:pb-8">
        <Outlet />
      </main>

      <nav className="safe-bottom md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[rgba(24,9,34,0.82)] backdrop-blur-2xl">
        <div className="mx-auto flex max-w-md items-center justify-around px-2 py-2">
          {navItems.map(({ to, labelKey, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-w-[72px] flex-col items-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-medium transition-all ${
                  isActive ? 'bg-brand-500/20 text-white' : 'text-slate-300 hover:text-white'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {t(labelKey)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  )
}

function ServicesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 00-2.15 1.588L2.35 13.177a2.25 2.25 0 00-.1.661V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M12 3v8.25m0 0l-3-3m3 3l3-3" />
    </svg>
  )
}

function PayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
    </svg>
  )
}

function ProfileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  )
}
