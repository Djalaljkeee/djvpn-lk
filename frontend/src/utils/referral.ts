const STORAGE_KEY = 'djvpn:partner_id'

const parseId = (raw: string | null | undefined): number | null => {
  if (!raw) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

// Захват из URL выполняется РОВНО ОДИН РАЗ за загрузку страницы. App вызывает
// captureRefIdFromUrl() в теле рендера, а сам URL мы намеренно не чистим (удобно
// для дебага) — без этого флага каждый повторный рендер после clearRefId()
// возвращал бы partner_id обратно в localStorage, и ref «прилипал» бы к
// устройству для всех будущих регистраций.
let capturedFromUrl = false

/** Считать `?ref=` (или `?partner_id=`) из текущего URL и сохранить в localStorage.
 *  Вызывается при старте приложения, переживает редиректы Telegram OAuth.
 *  Повторные вызовы только читают сохранённое значение. */
export function captureRefIdFromUrl(): number | null {
  if (typeof window === 'undefined') return null
  try {
    if (!capturedFromUrl) {
      capturedFromUrl = true
      const params = new URLSearchParams(window.location.search)
      const ref = parseId(params.get('ref') || params.get('partner_id'))
      if (ref) {
        window.localStorage.setItem(STORAGE_KEY, String(ref))
        return ref
      }
    }
    return parseId(window.localStorage.getItem(STORAGE_KEY))
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

/** Payload для Telegram-deeplink `https://t.me/<bot>?start=<payload>`.
 *
 *  SHM (`Core::Transport::Telegram`, обработка `/start`) декодирует аргумент
 *  как **base64url** и разбирает результат как query-строку `k=v&k=v`:
 *
 *      for my $pair ( split /&/, decode_base64url( $args[0] ) ) { ... }
 *      $args{partner_id} //= $start_args{pid};   # sub shmRegister
 *
 *  То есть партнёр передаётся ключом `pid`, а не голым числом: `?start=2`
 *  декодируется в мусор, пары `key=value` не даёт, и реферал теряется молча.
 *  Padding `=` убираем — Telegram допускает в start-параметре только
 *  `A-Za-z0-9_-`, а MIME::Base64::decode_base64url добивает его сам. */
export function encodeStartPayload(partnerId: number | string): string {
  const b64 = btoa(`pid=${partnerId}`)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function clearRefId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
