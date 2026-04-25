import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchDashboard, type DashboardData } from '../api/dashboard'
import { useAuthStore } from './authStore'

// Чуть длиннее backend-кеша (30s): мутации всё равно всегда инвалидируют,
// а бэкграунд-revalidate перекроет редкие внешние изменения (auto-renewal).
const TTL_MS = 60_000

interface DashboardState {
  data: DashboardData | null
  loadedAt: number | null
  loading: boolean      // true только при холодной загрузке без кеша
  refreshing: boolean   // background revalidation при наличии stale данных
  error: string | null
  ensure: (opts?: { force?: boolean }) => Promise<void>
  invalidate: () => Promise<void>
  reset: () => void
}

// Module-scope, чтобы дедуп переживал StrictMode double-mount и не попадал
// в localStorage через persist().
let inflight: Promise<void> | null = null

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      data: null,
      loadedAt: null,
      loading: false,
      refreshing: false,
      error: null,

      ensure: async ({ force = false } = {}) => {
        if (inflight && !force) return inflight
        const { data, loadedAt } = get()
        const fresh = data && loadedAt && Date.now() - loadedAt < TTL_MS
        if (fresh && !force) return

        set(data ? { refreshing: true } : { loading: true })

        const promise = fetchDashboard()
          .then(d => {
            set({
              data: d,
              loadedAt: Date.now(),
              loading: false,
              refreshing: false,
              error: null,
            })
            // Синхронизируем authStore.user, чтобы legacy-консьюмеры
            // (Layout balance, и пр.) видели свежий профиль.
            if (d.profile) useAuthStore.getState().setUser(d.profile)
          })
          .catch((e: unknown) => {
            const message = e instanceof Error ? e.message : 'Не удалось загрузить данные'
            set({ loading: false, refreshing: false, error: message })
          })
          .finally(() => {
            inflight = null
          })

        inflight = promise
        return promise
      },

      invalidate: async () => {
        await get().ensure({ force: true })
      },

      reset: () => {
        inflight = null
        set({
          data: null, loadedAt: null,
          loading: false, refreshing: false, error: null,
        })
      },
    }),
    {
      name: 'shm-dashboard',
      partialize: s => ({ data: s.data, loadedAt: s.loadedAt }),
    },
  ),
)

// Logout coupling: при сбросе токена в authStore — чистим кеш дашборда.
// Module-level подписка избегает циклических импортов.
useAuthStore.subscribe((state, prev) => {
  if (prev.token && !state.token) {
    useDashboardStore.getState().reset()
  }
})
