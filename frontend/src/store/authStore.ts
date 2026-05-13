import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'

interface AuthState {
  user: User | null
  setAuth: (user: User) => void
  setUser: (user: User) => void
  logout: () => void
  isAuthenticated: () => boolean
}

// Авторизация теперь через SHM cookie session_id (см. api/client.ts).
// В сторе храним только сам объект User для UI — токен/session_id браузер
// держит сам в HttpOnly-cookie на admin.djvpn.ru.
// Ключ shm-auth-v2 — старая запись (с JWT-токеном) автоматически
// игнорируется, пользователю покажется логин-экран один раз.
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      setAuth: (user) => set({ user }),
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
      isAuthenticated: () => !!get().user,
    }),
    { name: 'shm-auth-v2' }
  )
)
