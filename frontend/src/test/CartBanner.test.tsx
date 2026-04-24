import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import CartBanner from '../components/CartBanner'

function renderInRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('CartBanner', () => {
  it('shows service name and topup amount', () => {
    renderInRouter(
      <CartBanner
        payload={{ service_id: 1, service_name: 'VPN Pro', amount_needed: 199.5 }}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText(/VPN Pro/)).toBeInTheDocument()
    expect(screen.getByText(/199\.50/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Пополнить/ })).toBeInTheDocument()
  })

  it('omits topup amount when balance is sufficient', () => {
    renderInRouter(
      <CartBanner payload={{ service_id: 1, service_name: 'X' }} onDismiss={() => {}} />,
    )
    expect(screen.queryByText(/нужно пополнить/i)).not.toBeInTheDocument()
  })

  it('calls onDismiss when close button clicked', () => {
    const onDismiss = vi.fn()
    renderInRouter(
      <CartBanner payload={{ service_id: 1 }} onDismiss={onDismiss} />,
    )
    screen.getByLabelText('Скрыть').click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
