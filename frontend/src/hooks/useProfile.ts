import { useAuthStore } from '../store/authStore'
import { useDashboard, useDashboardSlice } from './useDashboard'

/**
 * Возвращает текущий профиль пользователя.
 * Триггерит хидрейшн /api/dashboard, если ещё не загружен.
 * Читает из dashboardStore (свежее), с fallback на persisted authStore.
 */
export function useProfile() {
  useDashboard()
  const fromDash = useDashboardSlice(d => d?.profile)
  const fromAuth = useAuthStore(s => s.user)
  return fromDash ?? fromAuth
}
