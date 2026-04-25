import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { fetchServices } from '../api/services'
import type { Service } from '../types'

// Каталог тарифов меняется только админом — TTL длинный.
const TTL_MS = 5 * 60_000

interface CatalogState {
  catalog: Service[] | null
  loadedAt: number | null
  loading: boolean
  refreshing: boolean
  error: string | null
  ensure: (opts?: { force?: boolean }) => Promise<void>
  invalidate: () => Promise<void>
  reset: () => void
}

let inflight: Promise<void> | null = null

export const useCatalogStore = create<CatalogState>()(
  persist(
    (set, get) => ({
      catalog: null,
      loadedAt: null,
      loading: false,
      refreshing: false,
      error: null,

      ensure: async ({ force = false } = {}) => {
        if (inflight && !force) return inflight
        const { catalog, loadedAt } = get()
        const fresh = catalog && loadedAt && Date.now() - loadedAt < TTL_MS
        if (fresh && !force) return

        set(catalog ? { refreshing: true } : { loading: true })

        const promise = fetchServices()
          .then(c => {
            set({
              catalog: c, loadedAt: Date.now(),
              loading: false, refreshing: false, error: null,
            })
          })
          .catch((e: unknown) => {
            const message = e instanceof Error ? e.message : 'Не удалось загрузить каталог'
            set({ loading: false, refreshing: false, error: message })
          })
          .finally(() => { inflight = null })

        inflight = promise
        return promise
      },

      invalidate: async () => { await get().ensure({ force: true }) },

      reset: () => {
        inflight = null
        set({ catalog: null, loadedAt: null, loading: false, refreshing: false, error: null })
      },
    }),
    {
      name: 'shm-catalog',
      partialize: s => ({ catalog: s.catalog, loadedAt: s.loadedAt }),
    },
  ),
)
