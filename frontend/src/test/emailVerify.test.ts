import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем только axios-клиент shm.post, остальное (unwrap/unwrapOne) — реальное.
// vi.hoisted — потому что фабрика vi.mock поднимается в начало файла.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, shm: { ...actual.shm, post } }
})

import { requestEmailVerification, verifyEmailToken } from '../api/user'

// SHM всегда отвечает 200; статус — в data[0].msg стандартного конверта.
const envelope = (msg: string) => ({ data: { data: [{ msg }], status: 200 } })

describe('verifyEmailToken', () => {
  beforeEach(() => post.mockReset())

  it('шлёт ТОЛЬКО {code} на /user/email/verify (без email, иначе SHM перевыпустит код)', async () => {
    post.mockResolvedValue(envelope('Email verified successfully'))
    const res = await verifyEmailToken('123456')
    expect(post).toHaveBeenCalledWith('/user/email/verify', { code: '123456' })
    expect(res.verified).toBe(true)
  })

  it('кидает ошибку на Invalid code', async () => {
    post.mockResolvedValue(envelope('Invalid code'))
    await expect(verifyEmailToken('000000')).rejects.toThrow('Неверный код')
  })

  it('кидает ошибку на Code expired', async () => {
    post.mockResolvedValue(envelope('Code expired'))
    await expect(verifyEmailToken('123456')).rejects.toThrow('истёк')
  })

  it('не рапортует успех, когда SHM код не принял (Email or code required)', async () => {
    post.mockResolvedValue(envelope('Email or code required'))
    await expect(verifyEmailToken('123456')).rejects.toThrow('Не удалось подтвердить')
  })
})

describe('requestEmailVerification', () => {
  beforeEach(() => post.mockReset())

  it('шлёт {email} на /user/email — иначе код повторно не уходит', async () => {
    post.mockResolvedValue(envelope('Verification code sent'))
    await requestEmailVerification('user@example.com')
    expect(post).toHaveBeenCalledWith('/user/email', { email: 'user@example.com' })
  })

  it('кидает ошибку при Email mismatch', async () => {
    post.mockResolvedValue(envelope('Email mismatch. Use the email shown in your profile.'))
    await expect(requestEmailVerification('user@example.com')).rejects.toThrow('Не удалось отправить')
  })
})
