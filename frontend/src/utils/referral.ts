const STORAGE_KEY = 'djvpn:partner_id'

const parseId = (raw: string | null | undefined): number | null => {
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Считать `?ref=` (или `?partner_id=`) из текущего URL и сохранить в localStorage.
 *  Вызывается один раз при старте приложения, переживает редиректы Telegram OAuth.
 *  URL не чистим — пусть остаётся для дебага; ключ один, перезатирается. */
export function captureRefIdFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const ref = parseId(params.get('ref') || params.get('partner_id'))
    if (ref) {
      window.localStorage.setItem(STORAGE_KEY, String(ref))
      return ref
    }
    const stored = parseId(window.localStorage.getItem(STORAGE_KEY))
    return stored
  } catch {
    return null
  }
}

/** Сохранить partner_id явно (для короткого роута /r/:id, где id уже
 *  выделен из path). Принимает строку — внутри валидирует через parseId. */
export function saveRefId(raw: string | number | null | undefined): number | null {
  if (typeof window === 'undefined') return null
  const id = parseId(typeof raw === 'number' ? String(raw) : raw)
  if (!id) return null
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id))
    return id
  } catch {
    return null
  }
}

export function getRefId(): number | null {
  if (typeof window === 'undefined') return null
  try {
    return parseId(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export function clearRefId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
