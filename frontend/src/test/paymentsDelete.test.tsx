import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Дашборд подменяем целиком — нам нужен только список платёжек.
const { paysystems, invalidate, removeSpy } = vi.hoisted(() => ({
  paysystems: [
    { name: 'Bank card *5777', paysystem: 'yookassa', shm_url: 'https://bill/pay?a=1', allow_deletion: 1 },
    { name: 'Банковскую карту РФ', paysystem: 'yookassa', shm_url: 'https://bill/pay?a=1' },
  ],
  invalidate: vi.fn(),
  removeSpy: vi.fn(),
}))

vi.mock('../hooks/useDashboard', () => ({
  useDashboard: () => ({ data: { paysystems }, loading: false, refreshing: false, error: null }),
  useDashboardSlice: (selector: (d: unknown) => unknown) => selector({ paysystems }),
  useInvalidateDashboard: () => invalidate,
}))

vi.mock('../api/services', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/services')>()
  return { ...actual, deleteAutopayment: removeSpy }
})

import PaymentsPage from '../pages/PaymentsPage'

const renderPage = () => render(<MemoryRouter><PaymentsPage /></MemoryRouter>)

describe('PaymentsPage — удаление сохранённой карты', () => {
  beforeEach(() => {
    removeSpy.mockReset()
    removeSpy.mockResolvedValue(undefined)
    invalidate.mockReset()
    invalidate.mockResolvedValue(undefined)
  })

  it('кнопка отвязки есть только у способа с allow_deletion', () => {
    renderPage()
    expect(screen.getByLabelText('Отвязать «Bank card *5777»')).toBeInTheDocument()
    expect(screen.queryByLabelText('Отвязать «Банковскую карту РФ»')).not.toBeInTheDocument()
  })

  it('клик → подтверждение → DELETE с кодом платёжной системы и рефреш дашборда', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Отвязать «Bank card *5777»'))

    expect(screen.getByText('Отвязать способ оплаты?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Отвязать' }))

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('yookassa'))
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    // Модалка закрывается только после успешного ответа SHM.
    await waitFor(() => expect(screen.queryByText('Отвязать способ оплаты?')).not.toBeInTheDocument())
  })

  it('ошибка SHM: модалка остаётся, список не «сбрасывается» молча', async () => {
    removeSpy.mockRejectedValue(new Error('500'))
    renderPage()
    fireEvent.click(screen.getByLabelText('Отвязать «Bank card *5777»'))
    fireEvent.click(screen.getByRole('button', { name: 'Отвязать' }))

    await waitFor(() => expect(removeSpy).toHaveBeenCalled())
    expect(invalidate).not.toHaveBeenCalled()
    expect(screen.getByText('Отвязать способ оплаты?')).toBeInTheDocument()
  })
})
