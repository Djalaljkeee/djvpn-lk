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
  await shm.post('/user/auth', { login, password })
  const user = await fetchSelf()
  return { user }
}

export const loginWithTelegram = async (tgData: object, partnerId?: number): Promise<AuthResult> => {
  const body = partnerId ? { ...tgData, partner_id: partnerId } : tgData
  await shm.post('/telegram/web/auth', body)
  const user = await fetchSelf()
  return { user }
}

export const loginWithWebApp = async (initData: string, partnerId?: number): Promise<AuthResult> => {
  const params: Record<string, string> = { initData }
  if (partnerId) params.partner_id = String(partnerId)
  await shm.get('/telegram/webapp/auth', { params })
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
  await shm.post('/user/auth', { login: payload.login, password: payload.password })

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
  // Прямой URL картинки на SHM. Браузер сам грузит и принимает cookie session_id,
  // которая дальше пойдёт в PUT /user.
  image_url: string
}

export const fetchCaptcha = async (): Promise<CaptchaData> => {
  // GET /user/captcha рендерит PNG и Set-Cookie ставит SHM. Возвращаем сам URL —
  // <img src="..."> с cross-origin + credentials заставит браузер запросить
  // и сохранить cookie, после чего PUT /user пройдёт валидацию.
  // Добавляем cache-buster, чтобы кнопка «Обновить» реально перезапросила картинку.
  const base = shm.defaults.baseURL || ''
  return { image_url: `${base}/user/captcha?_=${Date.now()}` }
}
