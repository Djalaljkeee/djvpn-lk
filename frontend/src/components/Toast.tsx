import { useState, createContext, useContext, useCallback } from 'react'

type ToastType = 'success' | 'error' | 'info'
interface ToastItem { id: number; msg: string; type: ToastType }

interface ToastCtx { show: (msg: string, type?: ToastType) => void }
const ToastContext = createContext<ToastCtx>({ show: () => {} })

export function useToast() { return useContext(ToastContext) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const show = useCallback((msg: string, type: ToastType = 'info') => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500)
  }, [])

  const colors: Record<ToastType, string> = {
    success: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    error:   'bg-red-500/15 border-red-500/30 text-red-300',
    info:    'bg-brand-600/15 border-brand-600/30 text-brand-300',
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`glass border rounded-xl px-4 py-3 text-sm font-medium shadow-xl animate-slide-up max-w-xs ${colors[t.type]}`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
