import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { shmPost, apiPost } = vi.hoisted(() => ({ shmPost: vi.fn(), apiPost: vi.fn() }))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    default: { ...actual.default, post: apiPost },
    shm: { ...actual.shm, post: shmPost },
  }
})

import { changePassword } from '../api/user'

const oldPasswordRequired = { response: { status: 400, data: { status: 400, error: 'OLD_PASSWORD_REQUIRED' } } }

describe('changePassword в Telegram Mini App на SHM 3.x', () => {
  beforeEach(() => {
    shmPost.mockReset()
    apiPost.mockReset()
  })
  afterEach(() => {
    delete (window as any).Telegram
  })

  it('OLD_PASSWORD_REQUIRED + initData → меняет пароль через бэкенд ЛК', async () => {
    ;(window as any).Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } }
    shmPost.mockRejectedValueOnce(oldPasswordRequired)
    apiPost.mockResolvedValueOnce({ data: { ok: true } })
    await expect(changePassword('newpass1')).resolves.toEqual({ ok: true })
    expect(apiPost).toHaveBeenCalledWith('/user/password', { password: 'newpass1', init_data: 'query_id=1&hash=abc' })
  })

  it('вне Telegram бэкенд не зовёт и просит текущий пароль', async () => {
    shmPost.mockRejectedValueOnce(oldPasswordRequired)
    await expect(changePassword('newpass1')).rejects.toThrow('Введите текущий пароль')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('на SHM 2.x (без ошибки) бэкенд не участвует', async () => {
    ;(window as any).Telegram = { WebApp: { initData: 'query_id=1&hash=abc' } }
    shmPost.mockResolvedValueOnce({ data: { data: [{}] } })
    await changePassword('newpass1')
    expect(apiPost).not.toHaveBeenCalled()
  })
})
