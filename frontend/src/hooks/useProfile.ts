import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { fetchProfile } from '../api/user'

/** Автоматически подгружает и обновляет профиль при монтировании */
export function useProfile() {
  const { user, setUser } = useAuthStore()

  useEffect(() => {
    fetchProfile().then(setUser).catch(() => {})
  }, [])

  return user
}
