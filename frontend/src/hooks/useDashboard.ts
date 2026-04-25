import { useEffect } from 'react'
import { useDashboardStore } from '../store/dashboardStore'
import { useCatalogStore } from '../store/catalogStore'
import type { DashboardData } from '../api/dashboard'
import type { Service } from '../types'

/**
 * Триггерит хидрейшн и возвращает агрегированный state.
 * Layout вызывает на маунт — это единственная точка входа в /api/dashboard.
 */
export function useDashboard() {
  const ensure = useDashboardStore(s => s.ensure)
  useEffect(() => { void ensure() }, [ensure])
  return useDashboardStore(s => ({
    data: s.data,
    loading: s.loading,
    refreshing: s.refreshing,
    error: s.error,
  }))
}

/** Узкий селектор — re-render только при изменении выбранной части. */
export function useDashboardSlice<T>(selector: (data: DashboardData | null) => T): T {
  return useDashboardStore(s => selector(s.data))
}

export const useInvalidateDashboard = () =>
  useDashboardStore(s => s.invalidate)

/** Каталог тарифов с собственным TTL (5 мин). Хидрейтит при первом use. */
export function useCatalog(): { catalog: Service[]; loading: boolean } {
  const ensure = useCatalogStore(s => s.ensure)
  useEffect(() => { void ensure() }, [ensure])
  const catalog = useCatalogStore(s => s.catalog) ?? []
  const loading = useCatalogStore(s => s.loading)
  return { catalog, loading }
}

export const useInvalidateCatalog = () =>
  useCatalogStore(s => s.invalidate)
