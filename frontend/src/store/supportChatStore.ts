import { create } from 'zustand'

interface SupportChatState {
  open: boolean
  openChat: () => void
  closeChat: () => void
  toggleChat: () => void
}

/**
 * Открыт ли виджет поддержки. Вынесено в store, чтобы чат можно было открыть
 * откуда угодно — из профиля, из уведомления, по `?support=1` в ссылке из
 * телеграм-дубля ответа.
 */
export const useSupportChatStore = create<SupportChatState>((set) => ({
  open: false,
  openChat: () => set({ open: true }),
  closeChat: () => set({ open: false }),
  toggleChat: () => set((s) => ({ open: !s.open })),
}))
