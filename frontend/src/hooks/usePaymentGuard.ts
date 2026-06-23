import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Защита от повторного создания платежей на фронте.
 *
 * Контекст (см. инцидент 23.06.2026, tasks/lessons.md): SHM-эндпоинт
 * `pay_systems/{ps}.cgi?action=payment` медленный и НЕ идемпотентный — повторный
 * вызов с тем же ts/amount инициирует ещё один реальный charge в ЮKassa. Сам
 * `action=payment` живёт на странице SHM (открывается у нас через window.open на
 * action=create) и фронтом не перехватывается. Но вектор, который фронт реально
 * контролирует, мы закрываем: пользователь, не дождавшись реакции, повторно жмёт
 * «Оплатить» и открывает НЕСКОЛЬКО параллельных платёжных сессий (каждый клик —
 * новый ts → отдельный платёж).
 *
 * Гард: пока активна платёжная сессия (в окне COOLDOWN_MS), повторный клик по той
 * же платёжке переоткрывает ту же вкладку с тем же url/ts (refocus, без нового
 * charge), а клик по другой — блокируется. Это устраняет случайные дубли-сессии.
 */
export const PAYMENT_WINDOW_NAME = 'djvpn_payment'
export const PAYMENT_COOLDOWN_MS = 60_000

export interface ActivePayment {
  key: string
  url: string
  openedAt: number
}

export type PaymentDecision = 'open' | 'refocus' | 'locked'
export type PaymentResult = PaymentDecision | 'blocked'

/**
 * Чистое решение, что делать с кликом по оплате. Вынесено из хука, чтобы
 * покрыть unit-тестом без DOM/window.
 *
 * - `open`    — активной сессии нет (или кулдаун истёк): создаём новую.
 * - `refocus` — тот же key в пределах кулдауна: переоткрываем сохранённый url.
 * - `locked`  — другой key, пока активна сессия: новую не создаём.
 */
export function decidePaymentAction(
  active: ActivePayment | null,
  key: string,
  now: number,
  cooldownMs: number,
): PaymentDecision {
  if (active && now - active.openedAt < cooldownMs) {
    return active.key === key ? 'refocus' : 'locked'
  }
  return 'open'
}

export function usePaymentGuard(cooldownMs: number = PAYMENT_COOLDOWN_MS) {
  const [active, setActive] = useState<ActivePayment | null>(null)
  // Держим окно, чтобы refocus возвращал пользователя на уже открытую вкладку.
  const winRef = useRef<Window | null>(null)

  // По истечении кулдауна сбрасываем сессию и форсим ре-рендер, чтобы кнопки
  // снова разблокировались (без этого таймера isActive «залипнет» до следующей
  // смены другого state).
  useEffect(() => {
    if (!active) return
    const remaining = active.openedAt + cooldownMs - Date.now()
    if (remaining <= 0) {
      setActive(null)
      return
    }
    const t = setTimeout(() => setActive(null), remaining)
    return () => clearTimeout(t)
  }, [active, cooldownMs])

  const isActive = active != null && Date.now() - active.openedAt < cooldownMs

  const openPayment = useCallback(
    (key: string, buildUrl: () => string): PaymentResult => {
      const now = Date.now()
      const decision = decidePaymentAction(active, key, now, cooldownMs)

      if (decision === 'locked') return 'locked'

      // refocus: переиспользуем сохранённый url (тот же ts) — не плодим charge.
      // open: строим url ОДИН раз (фиксируем ts) и сохраняем сессию.
      const url = decision === 'refocus' && active ? active.url : buildUrl()
      const win = window.open(url, PAYMENT_WINDOW_NAME)
      if (!win) return 'blocked'
      win.focus()
      winRef.current = win

      if (decision === 'open') {
        setActive({ key, url, openedAt: now })
      }
      return decision
    },
    [active, cooldownMs],
  )

  return {
    isActive,
    activeKey: isActive ? active!.key : null,
    openPayment,
  }
}
