import api from './client'

export interface CartPayload {
  service_id: number
  service_name?: string
  cost?: number
  amount_needed?: number
  balance?: number
}

export interface CartState {
  empty: boolean
  payload?: CartPayload
  updated_at?: string
}

export const fetchCart = (): Promise<CartState> =>
  api.get<CartState>('/user/cart').then((r) => r.data)

export const saveCart = (payload: CartPayload): Promise<CartState> =>
  api.put<CartState>('/user/cart', payload).then((r) => r.data)

export const clearCart = (): Promise<void> =>
  api.delete('/user/cart').then(() => undefined)
