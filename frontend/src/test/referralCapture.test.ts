import { beforeEach, describe, expect, it, vi } from 'vitest'

// Мокаем axios-клиент shm: нужны post/get/put как спаи.
const { put, post, get } = vi.hoisted(() => ({
  put: vi.fn(),
  post: vi.fn(),
  get: vi.fn(),
}))
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return { ...actual, shm: { ...actual.shm, put, post, get } }
})

import { loginWithTelegram, loginWithWebApp, fetchCaptcha, registerWithPassword } from '../api/auth'
import { encodeStartPayload } from '../utils/referral'

const envelope = (obj: unknown) => ({ data: { data: [obj], status: 200 } })
const tgUser = { id: 777, first_name: 'Ivan', auth_date: 1, hash: 'abc' }

beforeEach(() => {
  put.mockReset(); post.mockReset(); get.mockReset()
  put.mockResolvedValue(envelope({}))
  post.mockResolvedValue({ data: { session_id: 'sess' } })
  get.mockImplementation((url: string) => {
    if (url === '/telegram/webapp/auth') return Promise.resolve({ data: { session_id: 'sess' } })
    if (url === '/user') return Promise.resolve(envelope({ user_id: 5, login: '@777' }))
    return Promise.resolve(envelope({}))
  })
})

describe('Telegram Login Widget — регистрация нового пользователя', () => {
  it('шлёт register_if_not_exists=1, иначе SHM не создаёт юзера', async () => {
    await loginWithTelegram(tgUser)

    expect(post).toHaveBeenCalledWith(
      '/telegram/web/auth',
      expect.objectContaining({ ...tgUser, register_if_not_exists: 1 }),
    )
  })

  it('прокидывает partner_id рядом с данными виджета', async () => {
    await loginWithTelegram(tgUser, 42)

    const [, body] = post.mock.calls[0]
    expect(body).toMatchObject({ id: 777, register_if_not_exists: 1, partner_id: 42 })
  })

  it('без реферала partner_id не отправляется вовсе', async () => {
    await loginWithTelegram(tgUser)

    const [, body] = post.mock.calls[0]
    expect(body).not.toHaveProperty('partner_id')
  })

  it('бросает ошибку на «200 без сессии» и не идёт в /user за 401', async () => {
    // Ровно то, что SHM отдаёт при неуспехе web_auth: HTTP 200, data:[null].
    post.mockResolvedValue({ data: { data: [null], status: 200 } })

    await expect(loginWithTelegram(tgUser)).rejects.toThrow(/сесси/i)
    expect(get).not.toHaveBeenCalledWith('/user')
  })
})

describe('Telegram Mini App (webapp_auth)', () => {
  it('передаёт initData и partner_id в query', async () => {
    await loginWithWebApp('init-data-string', 42)

    expect(get).toHaveBeenCalledWith('/telegram/webapp/auth', {
      params: { initData: 'init-data-string', partner_id: '42' },
    })
  })

  it('бросает ошибку на «200 без сессии»', async () => {
    get.mockImplementation((url: string) => {
      if (url === '/telegram/webapp/auth') return Promise.resolve({ data: { data: [null], status: 200 } })
      return Promise.resolve(envelope({}))
    })

    await expect(loginWithWebApp('init-data-string')).rejects.toThrow(/сесси/i)
  })
})

describe('Капча при регистрации', () => {
  it('fetchCaptcha возвращает и картинку, и подписанный токен', async () => {
    get.mockResolvedValue(envelope({ image: 'PHN2Zz48L3N2Zz4=', token: 'tok-123' }))

    const data = await fetchCaptcha()

    expect(data.image_url).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    expect(data.token).toBe('tok-123')
  })

  it('registerWithPassword шлёт пару captcha_token + captcha_answer', async () => {
    await registerWithPassword({
      login: 'a@b.co',
      password: 'secret1',
      captcha_token: 'tok-123',
      captcha_answer: '7',
      partner_id: 42,
    })

    expect(put).toHaveBeenCalledWith('/user', expect.objectContaining({
      login: 'a@b.co',
      partner_id: 42,
      captcha_token: 'tok-123',
      captcha_answer: '7',
    }))
    // Старые имена полей SHM не понимает — их быть не должно.
    const [, body] = put.mock.calls[0]
    expect(body).not.toHaveProperty('captcha')
    expect(body).not.toHaveProperty('captcha_code')
  })
})

describe('encodeStartPayload — Telegram deeplink', () => {
  it('кодирует pid=<id> в base64url без padding', () => {
    // SHM: decode_base64url(arg) → «pid=2» → start_args{pid} → partner_id.
    expect(encodeStartPayload(2)).toBe('cGlkPTI')
    expect(atob('cGlkPTI=')).toBe('pid=2')
  })

  it('результат состоит только из допустимых для start-параметра символов', () => {
    for (const id of [1, 42, 999999, 12345678901]) {
      expect(encodeStartPayload(id)).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})

describe('captureRefIdFromUrl — захват ?ref= ровно один раз', () => {
  const load = async (search: string) => {
    vi.resetModules()
    window.history.replaceState({}, '', `/${search}`)
    return await import('../utils/referral')
  }

  beforeEach(() => {
    window.localStorage.clear()
  })

  it('кладёт ?ref= в localStorage и отдаёт его', async () => {
    const ref = await load('?ref=42')
    expect(ref.captureRefIdFromUrl()).toBe(42)
    expect(ref.getRefId()).toBe(42)
  })

  it('понимает ?partner_id= как синоним', async () => {
    const ref = await load('?partner_id=7')
    expect(ref.captureRefIdFromUrl()).toBe(7)
  })

  it('игнорирует мусор в ?ref=', async () => {
    const ref = await load('?ref=abc')
    expect(ref.captureRefIdFromUrl()).toBeNull()
    expect(ref.getRefId()).toBeNull()
  })

  it('после clearRefId() не возвращает ref обратно на повторных рендерах', async () => {
    const ref = await load('?ref=42')
    expect(ref.captureRefIdFromUrl()).toBe(42)

    // Успешная авторизация: ref использован и вычищен.
    ref.clearRefId()

    // App вызывает captureRefIdFromUrl() в теле рендера, а URL мы не чистим —
    // ref не должен «прилипнуть» к устройству для следующих регистраций.
    expect(ref.captureRefIdFromUrl()).toBeNull()
    expect(ref.getRefId()).toBeNull()
  })

  it('saveRefId принимает id из короткого роута /r/ref-<id>', async () => {
    const ref = await load('')
    expect(ref.saveRefId('2')).toBe(2)
    expect(ref.getRefId()).toBe(2)
    // Нулевые/отрицательные/нечисловые id отбрасываем.
    expect(ref.saveRefId('0')).toBeNull()
    expect(ref.saveRefId('-1')).toBeNull()
    expect(ref.saveRefId('ref-2')).toBeNull()
    expect(ref.getRefId()).toBe(2)
  })
})
