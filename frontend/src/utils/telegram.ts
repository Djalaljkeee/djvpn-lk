// Достаём photo_url аватарки пользователя из payload-а Telegram.
//
// SHM не хранит фото — после авторизации мы знаем URL картинки только
// из исходного auth-callback-а:
//   * Telegram Login Widget отдаёт объект `{ id, first_name, photo_url, ... }`
//     прямо в data-onauth → onTelegramAuth(user).
//   * Telegram WebApp кладёт user в `initData` как URL-encoded JSON в параметре
//     `user`: `initData = "query_id=...&user=%7B%22id%22%3A123,...%22photo_url%22%3A%22https...%22%7D&hash=..."`.
// Распарсить надёжнее самим: спецификация WebApp гарантирует URL-encoding,
// но Telegram-клиенты иногда добавляют непечатные символы — JSON.parse безопаснее
// регэкспа.

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export function getPhotoUrlFromTelegramUser(tgUser: unknown): string | null {
  if (!tgUser || typeof tgUser !== 'object') return null
  return asString((tgUser as Record<string, unknown>).photo_url)
}

export function getPhotoUrlFromInitData(initData: string | undefined | null): string | null {
  if (!initData) return null
  try {
    const params = new URLSearchParams(initData)
    const userRaw = params.get('user')
    if (!userRaw) return null
    const parsed = JSON.parse(userRaw)
    return getPhotoUrlFromTelegramUser(parsed)
  } catch {
    return null
  }
}
