import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем только axios-клиент shm.post, остальное (unwrap/unwrapOne) — реальное.
// vi.hoisted — потому что фабрика vi.mock поднимается в начало файла.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, shm: { ...actual.shm, post } }
})

import { changePassword, pickEmail, requestEmailVerification, verifyEmailToken } from '../api/user'

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

describe('verifyEmailToken на SHM 3.x', () => {
  beforeEach(() => post.mockReset())

  const notFound = Object.assign(new Error('Request failed with status code 404'), {
    response: { status: 404, data: { error: 'Ресурс не найден' } },
  })

  it('при 404 на /user/email/verify проверяет код через POST /user/email {email, code}', async () => {
    post.mockRejectedValueOnce(notFound).mockResolvedValueOnce(envelope('Email verified successfully'))
    const res = await verifyEmailToken('123456', 'user@example.com')
    expect(post).toHaveBeenNthCalledWith(2, '/user/email', { email: 'user@example.com', code: '123456' })
    expect(res.verified).toBe(true)
  })

  it('без email не уходит в /user/email — иначе 2.x перевыпустит код', async () => {
    post.mockRejectedValueOnce(notFound)
    await expect(verifyEmailToken('123456')).rejects.toBe(notFound)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('не-404 ошибки пробрасывает как есть', async () => {
    const boom = Object.assign(new Error('500'), { response: { status: 500 } })
    post.mockRejectedValueOnce(boom)
    await expect(verifyEmailToken('123456', 'user@example.com')).rejects.toBe(boom)
    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('pickEmail', () => {
  it('2.x: один объект', () => {
    expect(pickEmail([{ email: 'a@x.ru', email_verified: 0 }])).toEqual({ email: 'a@x.ru', email_verified: 0 })
  })

  it('3.x: берёт подтверждённый, а не первый', () => {
    const items = [
      { email: 'new@x.ru', email_verified: 0, is_primary: 0 },
      { email: 'ok@x.ru', email_verified: 1, is_primary: 0 },
    ]
    expect(pickEmail(items)?.email).toBe('ok@x.ru')
  })

  it('пустой список → null', () => {
    expect(pickEmail([])).toBeNull()
  })
})

describe('changePassword', () => {
  beforeEach(() => post.mockReset())

  it('шлёт old_password только если он задан', async () => {
    post.mockResolvedValue(envelope('ok'))
    await changePassword('newpass1')
    expect(post).toHaveBeenLastCalledWith('/user/passwd', { password: 'newpass1' })
    await changePassword('newpass1', 'oldpass')
    expect(post).toHaveBeenLastCalledWith('/user/passwd', { password: 'newpass1', old_password: 'oldpass' })
  })

  it('OLD_PASSWORD_REQUIRED из SHM 3.x → понятная ошибка', async () => {
    // Форма AxiosError, которую видит changePassword (только поле response).
    post.mockRejectedValueOnce({ response: { status: 400, data: { status: 400, error: 'OLD_PASSWORD_REQUIRED' } } })
    const err = await changePassword('newpass1').catch((e: Error) => e)
    expect((err as Error).message).toBe('Введите текущий пароль')
  })
})
