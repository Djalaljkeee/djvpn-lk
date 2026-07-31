import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем axios-клиент shm: нужен delete как спай.
const { del } = vi.hoisted(() => ({ del: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, shm: { ...actual.shm, delete: del } }
})

import { deleteAutopayment } from '../api/services'

describe('deleteAutopayment — отвязка сохранённой карты', () => {
  beforeEach(() => {
    del.mockReset()
    del.mockResolvedValue({ data: { status: 200 } })
  })

  it('шлёт DELETE /user/autopayment с кодом платёжной системы в query', async () => {
    await deleteAutopayment('yookassa')
    expect(del).toHaveBeenCalledWith('/user/autopayment', { params: { pay_system: 'yookassa' } })
  })

  it('ошибка SHM пробрасывается наверх — UI показывает toast, а не «успех»', async () => {
    del.mockRejectedValue(new Error('403'))
    await expect(deleteAutopayment('yookassa')).rejects.toThrow('403')
  })
})
