import { useCallback, useEffect, useState } from 'react'

import { clearCart, fetchCart, saveCart, type CartPayload, type CartState } from '../api/cart'

/**
 * useCart — лёгкий хук вокруг cart-API с локальным кешом.
 *
 * Если backend без БД (503) — молча считаем корзину пустой, фронт работает
 * как раньше.
 */
export function useCart() {
  const [state, setState] = useState<CartState>({ empty: true })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const next = await fetchCart()
      setState(next)
    } catch {
      setState({ empty: true })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async (payload: CartPayload) => {
    try {
      const next = await saveCart(payload)
      setState(next)
    } catch {
      /* ignore — stateless backend */
    }
  }, [])

  const clear = useCallback(async () => {
    try {
      await clearCart()
    } finally {
      setState({ empty: true })
    }
  }, [])

  return { state, loading, refresh, save, clear }
}
