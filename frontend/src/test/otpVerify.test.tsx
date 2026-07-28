import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import OtpVerify from '../components/OtpVerify'

// framer-motion's useReducedMotion читает window.matchMedia, которого нет в
// jsdom — полифилл возвращает «движение включено».
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  }
})

const noop = () => {}

function renderOtp(overrides: Partial<React.ComponentProps<typeof OtpVerify>> = {}) {
  const onSubmit = vi.fn()
  render(
    <OtpVerify
      email="user@example.com"
      onSubmit={onSubmit}
      onResend={noop}
      onSkip={noop}
      loading={false}
      resending={false}
      error=""
      success=""
      {...overrides}
    />,
  )
  return { onSubmit }
}

describe('OtpVerify', () => {
  it('рендерит 6 numeric-ячеек', () => {
    renderOtp()
    const cells = screen.getAllByLabelText('Цифра кода')
    expect(cells).toHaveLength(6)
    expect(cells[0]).toHaveAttribute('inputmode', 'numeric')
  })

  it('автосабмит вызывает onSubmit с 6-значным кодом после заполнения', () => {
    const { onSubmit } = renderOtp()
    const cells = screen.getAllByLabelText('Цифра кода') as HTMLInputElement[]
    '123456'.split('').forEach((d, i) => {
      fireEvent.change(cells[i], { target: { value: d } })
    })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('игнорирует нецифровой ввод', () => {
    const { onSubmit } = renderOtp()
    const cells = screen.getAllByLabelText('Цифра кода') as HTMLInputElement[]
    fireEvent.change(cells[0], { target: { value: 'a' } })
    expect(cells[0].value).toBe('')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('вставка всего кода распределяет цифры и сабмитит', () => {
    const { onSubmit } = renderOtp()
    const cells = screen.getAllByLabelText('Цифра кода') as HTMLInputElement[]
    fireEvent.paste(cells[0], {
      clipboardData: { getData: () => '654321' },
    })
    expect(onSubmit).toHaveBeenCalledWith('654321')
  })
})
