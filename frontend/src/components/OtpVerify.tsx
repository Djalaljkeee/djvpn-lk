import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from 'framer-motion'

/**
 * Премиальная OTP-анимация для подтверждения email (6-значный код SHM).
 *
 * Экран живёт внутри стеклянной карточки логина. Логика ввода честная:
 * шесть <input> с numeric-клавиатурой, вставкой всего кода, backspace и
 * автозаполнением из SMS/письма (autocomplete="one-time-code"). Motion-слои
 * поверх — чисто визуальные.
 *
 * Стейт-машина: input → verifying → (success | обратно в input при error).
 *  - при заполнении всех 6 ячеек вызываем onSubmit(code) и оптимистично
 *    запускаем «сборку»: квадраты разлетаются пружиной, слетаются в один
 *    токен, вокруг рисуется кольцо (красное);
 *  - когда бэкенд подтвердил (prop success) — кольцо перетекает в зелёный,
 *    рисуется галочка, расходится ripple, карточка чуть зеленеет, заголовок
 *    сменяется, появляется бейдж «Подтверждено и защищено 🔒»;
 *  - при ошибке (prop error) возвращаемся к вводу с красным shake.
 */

const LENGTH = 6
const RED = '#ff5b5b'
const GREEN = '#1ED760'

const SPRING_BORDER: Transition = { type: 'spring', stiffness: 380, damping: 25 }
const SPRING_SOFT: Transition = { type: 'spring', stiffness: 120, damping: 12 }

type Props = {
  email: string
  onSubmit: (code: string) => void
  onResend: () => void
  onSkip: () => void
  loading: boolean
  resending: boolean
  error: string
  success: string
}

export default function OtpVerify({
  email,
  onSubmit,
  onResend,
  onSkip,
  loading,
  resending,
  error,
  success,
}: Props) {
  const reduce = useReducedMotion()
  const [digits, setDigits] = useState<string[]>(() => Array(LENGTH).fill(''))
  const [focused, setFocused] = useState<number>(0)
  const [phase, setPhase] = useState<'input' | 'verifying'>('input')
  const [shakeKey, setShakeKey] = useState(0)
  // «Раскрытие» успеха: заголовок/зелёная заливка/бейдж включаются НЕ по факту
  // ответа бэкенда, а в момент, когда кольцо дорисовалось и появляется галочка,
  // — иначе карточка «зеленеет» раньше самой анимации проверки.
  const [revealed, setRevealed] = useState(false)
  const inputs = useRef<Array<HTMLInputElement | null>>([])
  const submittedRef = useRef(false)

  const code = digits.join('')
  const succeeded = Boolean(success)

  const focusCell = useCallback((i: number) => {
    const el = inputs.current[i]
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  // Автосабмит, когда все 6 цифр введены (один раз на попытку).
  useEffect(() => {
    if (phase !== 'input') return
    if (code.length === LENGTH && !submittedRef.current) {
      submittedRef.current = true
      setPhase('verifying')
      onSubmit(code)
    }
  }, [code, phase, onSubmit])

  // Ошибка от бэкенда — назад к вводу, красный shake, чистим и фокусируемся.
  useEffect(() => {
    if (error && phase === 'verifying') {
      setPhase('input')
      setDigits(Array(LENGTH).fill(''))
      setShakeKey(k => k + 1)
      setRevealed(false)
      submittedRef.current = false
      const t = setTimeout(() => focusCell(0), 0)
      return () => clearTimeout(t)
    }
  }, [error, phase, focusCell])

  const setDigit = (i: number, val: string) => {
    setDigits(prev => {
      const next = [...prev]
      next[i] = val
      return next
    })
  }

  const handleChange = (i: number, raw: string) => {
    const clean = raw.replace(/\D/g, '')
    if (!clean) {
      setDigit(i, '')
      return
    }
    if (clean.length > 1) {
      // Вставка/автозаполнение всего кода: распределяем по ячейкам.
      setDigits(prev => {
        const next = [...prev]
        for (let k = 0; k < clean.length && i + k < LENGTH; k++) {
          next[i + k] = clean[k]
        }
        return next
      })
      const nextIdx = Math.min(i + clean.length, LENGTH - 1)
      focusCell(nextIdx)
      return
    }
    setDigit(i, clean)
    if (i < LENGTH - 1) focusCell(i + 1)
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (digits[i]) {
        setDigit(i, '')
      } else if (i > 0) {
        e.preventDefault()
        setDigit(i - 1, '')
        focusCell(i - 1)
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      focusCell(i - 1)
    } else if (e.key === 'ArrowRight' && i < LENGTH - 1) {
      focusCell(i + 1)
    }
  }

  const handlePaste = (i: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    handleChange(i, e.clipboardData.getData('text'))
  }

  return (
    <div>
      {/* Заголовок — перетекает при успехе (fade/slide). */}
      <div className="relative mb-6 min-h-[74px]">
        <AnimatePresence mode="wait" initial={false}>
          {revealed ? (
            <motion.div
              key="verified"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={SPRING_SOFT}
            >
              <h2 className="text-2xl font-bold text-white">Email подтверждён</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Ваш адрес <span className="font-medium text-white">{email}</span> подтверждён.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="verify"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={SPRING_SOFT}
            >
              <h2 className="text-2xl font-bold text-white">Подтвердите email</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Мы отправили 6-значный код на{' '}
                <span className="font-medium text-white">{email}</span>. Проверка пройдёт
                автоматически.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Тёмная сцена, чтобы неон читался поверх фиолетовой карточки. */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0e0d10] p-5">
        {/* Мягкая зелёная заливка фона после успеха (не более ~10%). */}
        <motion.div
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ backgroundColor: revealed ? 'rgba(30,215,96,0.10)' : 'rgba(30,215,96,0)' }}
          transition={{ duration: 0.8 }}
        />

        <div className="relative flex min-h-[240px] items-center justify-center">
          {phase === 'input' ? (
              <motion.div
                key={`input-${shakeKey}`}
                initial={{ opacity: 0 }}
                animate={
                  reduce
                    ? { opacity: 1 }
                    : { opacity: 1, x: shakeKey ? [0, -12, 12, -8, 8, 0] : 0 }
                }
                transition={shakeKey ? { duration: 0.4 } : { duration: 0.2 }}
                className="flex gap-2.5 sm:gap-3"
              >
                {digits.map((d, i) => (
                  <Cell
                    key={i}
                    inputRef={el => (inputs.current[i] = el)}
                    value={d}
                    active={focused === i}
                    error={Boolean(error)}
                    reduce={Boolean(reduce)}
                    onChange={v => handleChange(i, v)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onPaste={e => handlePaste(i, e)}
                    onFocus={() => setFocused(i)}
                  />
                ))}
              </motion.div>
            ) : (
              <VerifyStage
                key="verify-stage"
                digits={digits}
                succeeded={succeeded}
                reduce={Boolean(reduce)}
                onVerified={() => setRevealed(true)}
              />
            )}
        </div>

        {/* Бейдж после успеха. */}
        <AnimatePresence>
          {revealed && (
            <motion.div
              key="badge"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING_SOFT, delay: 0.35 }}
              className="relative mt-3 text-center text-sm font-medium text-emerald-300"
            >
              Подтверждено и защищено 🔒
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Ошибка. */}
      <AnimatePresence>
        {error && !revealed && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resend / Skip — показываем только на этапе ввода. */}
      {phase === 'input' && (
        <div className="mt-5 flex flex-col items-center gap-2 text-center text-sm text-slate-300">
          <div>
            <span className="text-slate-400">Не получили код? </span>
            <button
              type="button"
              onClick={onResend}
              disabled={resending || loading}
              className="font-semibold text-fuchsia-200 hover:text-white disabled:opacity-60"
            >
              {resending ? 'Отправка…' : 'Отправить повторно'}
            </button>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-slate-400 hover:text-white"
          >
            Пропустить (подтвердить позже в профиле)
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------- Ячейка ---------------------------------- */

type CellProps = {
  value: string
  active: boolean
  error: boolean
  reduce: boolean
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
  onFocus: () => void
}

const Cell = ({
  inputRef,
  value,
  active,
  error,
  reduce,
  onChange,
  onKeyDown,
  onPaste,
  onFocus,
}: CellProps & { inputRef: (el: HTMLInputElement | null) => void }) => {
  return (
    <motion.label
      className="relative block h-14 w-11 cursor-text sm:h-16 sm:w-12"
      style={{ willChange: 'transform' }}
      whileHover={reduce ? undefined : { scale: 1.03 }}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      animate={{ scale: active && !reduce ? 1.08 : 1 }}
      transition={SPRING_BORDER}
    >
      {/* База ячейки + очень слабое внутреннее свечение; при ошибке тон краснеет. */}
      <div
        className={`absolute inset-0 rounded-2xl border bg-[#151315] ${
          error ? 'border-rose-500/40' : 'border-white/10'
        }`}
        style={{ boxShadow: 'inset 0 0 18px rgba(255,255,255,0.03)' }}
      />
      {/* Перетекающая неоновая рамка (shared layout). */}
      {active && (
        <motion.div
          layoutId="otp-active-border"
          className="absolute inset-0 rounded-2xl border-2"
          style={{
            borderColor: RED,
            boxShadow: '0 0 40px rgba(255,91,91,.35)',
            willChange: 'transform',
          }}
          transition={SPRING_BORDER}
        />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={onFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={1}
        aria-label="Цифра кода"
        className="absolute inset-0 h-full w-full rounded-2xl bg-transparent text-center text-2xl font-semibold text-white caret-[#ff5b5b] outline-none"
      />
      {/* Появление цифры: scale 0.6→1, fade, лёгкий bounce. */}
      <AnimatePresence>
        {value && (
          <motion.span
            key={value}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-2xl font-semibold text-white"
          >
            {value}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.label>
  )
}

/* ---------------------- Сцена сборки и верификации ----------------------- */

function VerifyStage({
  digits,
  succeeded,
  reduce,
  onVerified,
}: {
  digits: string[]
  succeeded: boolean
  reduce: boolean
  onVerified: () => void
}) {
  // stage: scatter → merge → ring (→ зелёный/галочка по succeeded)
  const [stage, setStage] = useState<'scatter' | 'merge' | 'ring'>(
    reduce ? 'ring' : 'scatter',
  )
  const [ringDrawn, setRingDrawn] = useState(reduce)

  // Разлёт по кругу + случайный поворот ±20° (детерминированно на маунт).
  const scatter = useMemo(
    () =>
      digits.map((_, i) => {
        const angle = (i / LENGTH) * Math.PI * 2 - Math.PI / 2
        const radius = 78
        return {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          rotate: (i % 2 === 0 ? 1 : -1) * (12 + (i * 7) % 9),
        }
      }),
    [digits],
  )

  useEffect(() => {
    if (reduce) return
    const t1 = setTimeout(() => setStage('merge'), 600)
    const t2 = setTimeout(() => setStage('ring'), 1200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [reduce])

  const verified = succeeded && stage === 'ring' && ringDrawn
  const glowColor = verified ? 'rgba(30,215,96,.45)' : 'rgba(255,91,91,.35)'
  const glowSize = verified ? '50px' : '40px'

  // Сообщаем родителю ровно в момент раскрытия — синхронно с галочкой.
  const verifiedRef = useRef(false)
  useEffect(() => {
    if (verified && !verifiedRef.current) {
      verifiedRef.current = true
      onVerified()
    }
  }, [verified, onVerified])

  const showToken = stage === 'ring' || reduce

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative h-[240px] w-[240px]"
    >
      {/* Ripple после успеха. */}
      <AnimatePresence>
        {verified && !reduce && (
          <div key="ripple" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <motion.div
              className="h-24 w-24 rounded-full"
              style={{ backgroundColor: GREEN, willChange: 'transform' }}
              initial={{ scale: 0.3, opacity: 0.35 }}
              animate={{ scale: 7, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Кольцо верификации: красное → зелёное. */}
      {showToken && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <svg className="h-[190px] w-[190px] -rotate-90" viewBox="0 0 120 120" fill="none">
            <motion.circle
              cx="60"
              cy="60"
              r="54"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1, stroke: verified ? GREEN : RED }}
              transition={{
                pathLength: { duration: reduce ? 0 : 0.7, ease: 'easeInOut' },
                stroke: { duration: 0.6 },
              }}
              onAnimationComplete={() => setRingDrawn(true)}
            />
          </svg>
        </div>
      )}

      {/* Разлетающиеся квадраты с цифрами (scatter + merge) — каждый в своём
          центрирующем слое, чтобы x/y считались от центра сцены. */}
      <AnimatePresence>
        {stage !== 'ring' &&
          digits.map((d, i) => (
            <div
              key={i}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <motion.div
                className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 bg-[#151315] text-2xl font-semibold text-white"
                style={{
                  borderColor: RED,
                  boxShadow: '0 0 40px rgba(255,91,91,.35)',
                  willChange: 'transform',
                }}
                initial={{ x: 0, y: 0, rotate: 0, scale: 0.9 }}
                animate={
                  stage === 'scatter'
                    ? { x: scatter[i].x, y: scatter[i].y, rotate: scatter[i].rotate, scale: 1 }
                    : { x: 0, y: 0, rotate: 0, scale: [1, 0.85, 1] }
                }
                exit={{ opacity: 0, scale: 0.85 }}
                transition={SPRING_SOFT}
              >
                <motion.span
                  animate={{ opacity: stage === 'merge' ? 0 : 1 }}
                  transition={{ duration: 0.3 }}
                >
                  {d}
                </motion.span>
              </motion.div>
            </div>
          ))}
      </AnimatePresence>

      {/* Итоговый токен (после слияния). */}
      {showToken && (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="flex h-[92px] w-[92px] items-center justify-center rounded-[26px] border-2 bg-[#151315]"
            style={{ willChange: 'transform' }}
            initial={{ scale: reduce ? 1 : 0.85 }}
            animate={{
              scale: [0.85, 1.04, 1],
              borderColor: verified ? GREEN : RED,
              boxShadow: `0 0 ${glowSize} ${glowColor}`,
            }}
            transition={{ scale: SPRING_SOFT, borderColor: { duration: 0.6 } }}
          >
            {/* Галочка после успеха. */}
            <AnimatePresence>
              {verified && (
                <motion.svg
                  key="check"
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  initial={{ scale: 0.6 }}
                  animate={{ scale: [0.6, 1.15, 1] }}
                  transition={SPRING_SOFT}
                >
                  <motion.path
                    d="M5 12.5l4.2 4.2L19 7"
                    stroke={GREEN}
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.4, ease: 'easeInOut' }}
                  />
                </motion.svg>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
