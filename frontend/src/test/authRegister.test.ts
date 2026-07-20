import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем весь axios-клиент shm: нужны put/post/get как спаи.
const { put, post, get } = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
}))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, shm: { ...actual.shm, put, post, get } }
})

import { registerWithPassword } from '../api/auth'

const envelope = (obj: unknown) => ({ data: { data: [obj], status: 200 } })

describe('registerWithPassword — привязка email', () => {
  beforeEach(() => {
    put.mockReset(); post.mockReset(); get.mockReset()
    // PUT /user (создание), PUT /user/email (set_email)
    put.mockResolvedValue(envelope({}))
    // POST /user/auth (сессия), POST /user/email (отправка кода)
    post.mockImplementation((url: string) => {
      if (url === '/user/auth') return Promise.resolve({ data: { id: 'sess123' } })
      if (url === '/user/email') return Promise.resolve(envelope({ msg: 'Verification code sent' }))
      return Promise.resolve(envelope({}))
    })
    // fetchSelf: GET /user и GET /user/email
    get.mockImplementation((url: string) => {
      if (url === '/user') return Promise.resolve(envelope({ user_id: 1, login: 'a@b.co' }))
      if (url === '/user/email') return Promise.resolve(envelope({ email: 'a@b.co', email_verified: 0 }))
      return Promise.resolve(envelope({}))
    })
  })

  it('перед отправкой кода вызывает set_email (PUT /user/email), иначе SHM его не сохранит', async () => {
    const res = await registerWithPassword({ login: 'a@b.co', password: 'x', email: 'a@b.co' })

    // set_email обязателен — reg_api_safe (PUT /user) email не сохраняет.
    expect(put).toHaveBeenCalledWith('/user/email', { email: 'a@b.co' })
    // и только потом отправка кода
    expect(post).toHaveBeenCalledWith('/user/email', { email: 'a@b.co' })

    // PUT /user/email должен идти РАНЬШЕ POST /user/email
    const putOrder = put.mock.invocationCallOrder[
      put.mock.calls.findIndex((c) => c[0] === '/user/email')
    ]
    const postOrder = post.mock.invocationCallOrder[
      post.mock.calls.findIndex((c) => c[0] === '/user/email')
    ]
    expect(putOrder).toBeLessThan(postOrder)

    expect(res.email_verification_sent).toBe(true)
  })

  it('email_verification_sent=false, если SHM вернул не "Verification code sent"', async () => {
    post.mockImplementation((url: string) => {
      if (url === '/user/auth') return Promise.resolve({ data: { id: 'sess123' } })
      if (url === '/user/email') return Promise.resolve(envelope({ msg: 'Email mismatch. Use the email shown in your profile.' }))
      return Promise.resolve(envelope({}))
    })
    const res = await registerWithPassword({ login: 'a@b.co', password: 'x', email: 'a@b.co' })
    expect(res.email_verification_sent).toBe(false)
  })
})
