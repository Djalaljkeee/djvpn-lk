import type { AxiosResponse } from 'axios'
import { shm, unwrapOne } from './client'
import type { User } from '../types'

export interface AuthResult {
  user: User
  email_verification_sent?: boolean
}

export interface RegisterPayload {
  login: string
  password: string
  name?: string
  email?: string
  captcha_token?: string
  captcha_code?: string
  partner_id?: number
}

// Резервный канал для session_id: достаём из тела auth-ответа и пишем в
// document.cookie. Бек уже шлёт корректный Set-Cookie (HttpOnly; Secure;
// SameSite=Lax), но некоторые браузерные фильтры приватности (наблюдается
// в YaBrowser «Protect» на GET /telegram/webapp/auth с большим query-
// string'ом из initData) молча выбрасывают HttpOnly-куку, считая endpoint
// трекером — и следующий /v1/user летит без сессии и ловит 401.
// Дублирующая запись через document.cookie не HttpOnly (JS обязан её
// видеть), но (name, path, domain) совпадают со server-side кукой, и по
// RFC 6265 они перезатирают друг друга, так что итоговая кука одна.
function captureSessionFromBody(resp: AxiosResponse): void {
  const body = resp.data
  if (!body || typeof body !== 'object') return
  const sessionId: unknown =
    body.session_id ??
    body.id ??
    body.data?.[0]?.session_id ??
    body.data?.[0]?.id
  if (typeof sessionId !== 'string' || !sessionId) return
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `session_id=${sessionId}; Path=/; SameSite=Lax${secure}`
}

async function fetchSelf(): Promise<User> {
  const resp = await shm.get('/user')
  const user = unwrapOne<User>(resp)
  if (!user) throw new Error('SHM /user не вернул профиль')
  // Если у пользователя есть email — догружаем (флаг email_verified и пр.).
  try {
    const emailResp = await shm.get('/user/email')
    const emailObj = unwrapOne<Partial<User>>(emailResp)
    if (emailObj) Object.assign(user, emailObj)
  } catch {
    // /user/email может вернуть 404, если email ещё не привязан — это ок.
  }
  return user
}

export const loginWithPassword = async (login: string, password: string): Promise<AuthResult> => {
  // POST /user/auth — SHM ставит cookie session_id (Secure; HttpOnly; SameSite=None).
  const resp = await shm.post('/user/auth', { login, password })
  captureSessionFromBody(resp)
  const user = await fetchSelf()
  return { user }
}

export const loginWithTelegram = async (tgData: object, partnerId?: number): Promise<AuthResult> => {
  const body = partnerId ? { ...tgData, partner_id: partnerId } : tgData
  const resp = await shm.post('/telegram/web/auth', body)
  captureSessionFromBody(resp)
  const user = await fetchSelf()
  return { user }
}

export const loginWithWebApp = async (initData: string, partnerId?: number): Promise<AuthResult> => {
  const params: Record<string, string> = { initData }
  if (partnerId) params.partner_id = String(partnerId)
  const resp = await shm.get('/telegram/webapp/auth', { params })
  captureSessionFromBody(resp)
  const user = await fetchSelf()
  return { user }
}

export const registerWithPassword = async (payload: RegisterPayload): Promise<AuthResult> => {
  // Публичная регистрация: PUT /user. SHM требует cookie session_id из
  // предварительного GET /user/captcha — withCredentials прокидывает её
  // автоматически. После создания делаем POST /user/auth, чтобы получить
  // session_id текущего пользователя (cookie от captcha — не его).
  const body: Record<string, unknown> = {
    login: payload.login,
    password: payload.password,
  }
  if (payload.name) body.name = payload.name
  if (payload.email) body.email = payload.email
  if (payload.partner_id) body.partner_id = payload.partner_id
  if (payload.captcha_code) {
    body.captcha = payload.captcha_code
    body.captcha_code = payload.captcha_code
  }
  await shm.put('/user', body)
  const authResp = await shm.post('/user/auth', { login: payload.login, password: payload.password })
  captureSessionFromBody(authResp)

  // Просим SHM отправить письмо с кодом верификации email.
  let email_verification_sent = false
  if (payload.email) {
    try {
      await shm.post('/user/email', { email: payload.email })
      email_verification_sent = true
    } catch {
      // SHM может не уметь рассылать письма — это не блокирует регистрацию.
    }
  }

  const user = await fetchSelf()
  return { user, email_verification_sent }
}

export interface CaptchaData {
  // data: URL с распакованной SVG-картинкой. SHM `/user/captcha` отдаёт
  // НЕ raw image, а JSON вида `{TZ, data: [{image: "<base64-svg>"}]}`,
  // поэтому прямой `<img src="/api/shm/.../captcha">` рендерится как
  // broken-image: браузер видит `Content-Type: application/json` и
  // отказывается интерпретировать тело как картинку. Здесь делаем
  // честный fetch, достаём base64 из `data[0].image` и собираем data: URL
  // — `<img>` тогда рисует SVG локально, без сетевых проверок.
  image_url: string
}

export const fetchCaptcha = async (): Promise<CaptchaData> => {
  // withCredentials=true (см. api/client.ts) — cookie session_id, которую
  // SHM ставит в ответе, сохраняется на домене ЛК и автоматически уйдёт
  // в PUT /user, где SHM сматчит код против сессии.
  const resp = await shm.get('/user/captcha')
  const item = unwrapOne<{ image?: string }>(resp)
  const b64 = item?.image
  if (typeof b64 !== 'string' || !b64) {
    throw new Error('captcha: empty response')
  }
  return { image_url: `data:image/svg+xml;base64,${b64}` }
}
