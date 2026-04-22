import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useToast } from '../components/Toast'
import { updateEmail, fetchProfile } from '../api/user'

const TOS_TEXT = `Настоящее Пользовательское соглашение (далее — «Соглашение») регулирует отношения между пользователем (далее — «Пользователь») и сервисом DJ VPN (далее — «Сервис») относительно использования услуг.

Используя Сервис, Пользователь подтверждает согласие с условиями данного Соглашения и обязуется соблюдать применимое законодательство страны своего пребывания.

1. ПРЕДМЕТ СОГЛАШЕНИЯ

1.1. Сервис предоставляет Пользователю услуги по обеспечению безопасности соединения в сети Интернет, включая VPN-соединения (далее — «Услуги»).
1.2. Сервис обеспечивает конфиденциальность соединения путём шифрования трафика и сокрытия IP-адреса Пользователя.
1.3. Используемые IP-адреса могут использоваться множеством пользователей одновременно.
1.4. Сервис не анализирует содержимое пользовательского трафика и не вмешивается в него, за исключением случаев, необходимых для обеспечения безопасности, стабильности и работоспособности инфраструктуры.

2. ПОДПИСКА И ОПЛАТА

2.1. Услуги предоставляются на условиях предоплаты согласно действующим тарифам, опубликованным на официальных ресурсах DJ VPN.
2.2. Автоматическое продление отсутствует.
2.3. Сервис вправе изменять стоимость подписки.
2.4. Все платежи являются окончательными, за исключением случаев, предусмотренных разделом 6 настоящего Соглашения.

3. ПРАВА И ОБЯЗАННОСТИ СТОРОН

3.1. Сервис обязуется предоставлять Услуги в рамках своих технических возможностей.
3.2. Пользователь обязуется использовать Сервис только в законных целях.
3.3. Пользователь несёт ответственность за сохранность своих учётных данных и любые действия, совершённые с использованием его аккаунта.

4. ЗАПРЕЩЁННЫЕ ДЕЙСТВИЯ

Пользователь не вправе использовать Сервис для:
• распространения нелегального контента;
• доступа к системам без разрешения;
• распространения вредоносного ПО, спама или фишинга;
• массовых автоматизированных запросов;
• использования Сервиса для противоправной деятельности, включая обход ограничений, связанных с незаконной деятельностью;
• использования сервисов, создающих чрезмерную нагрузку на инфраструктуру (включая Tor при некорректной конфигурации).

5. FAIR USAGE POLICY

5.1. Сервис предназначен для личного использования.
5.2. Сервис вправе ограничить доступ при:
• чрезмерной нагрузке;
• автоматизированной активности;
• нарушении условий Соглашения.

6. ПОЛИТИКА ВОЗВРАТА

6.1. Пользователь может запросить возврат средств в течение 7 дней.
6.2. Каждая заявка рассматривается индивидуально.
6.3. Сервис не гарантирует работоспособность в условиях ограничений со стороны провайдеров или государственных органов.
6.4. Отсутствие доступа по причинам, не зависящим от Сервиса, не является гарантированным основанием для возврата.

7. КОНФИДЕНЦИАЛЬНОСТЬ

7.1. Сервис придерживается политики отсутствия логирования пользовательской активности (no-logs) и не хранит историю посещённых ресурсов.
7.2. Сервис может обрабатывать минимально необходимую техническую информацию (например, временные метаданные соединений) исключительно для обеспечения работы, безопасности и предотвращения злоупотреблений.
7.3. Передача данных государственным органам возможна только в рамках применимого законодательства и только в пределах фактически имеющейся информации.

8. ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ

8.1. Сервис предоставляется «как есть».
8.2. Сервис не гарантирует непрерывную работу или отсутствие ошибок.
8.3. Сервис не несёт ответственности за ограничения доступа, вызванные действиями третьих лиц.
8.4. Совокупная ответственность Сервиса ограничивается суммой, уплаченной Пользователем за последние 30 дней.

9. ПРЕКРАЩЕНИЕ ДОСТУПА

9.1. Сервис вправе приостановить или ограничить доступ в случае нарушения условий Соглашения или угрозы инфраструктуре.
9.2. Пользователь может прекратить использование Сервиса, не продлевая подписку.

10. ИЗМЕНЕНИЯ СОГЛАШЕНИЯ

10.1. Сервис вправе изменять условия.
10.2. Обновления публикуются в официальных источниках.
10.3. Продолжение использования означает согласие.

11. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ

11.1. Споры решаются в соответствии с применимым правом.`

export default function ProfilePage() {
  const { user, setUser, logout } = useAuthStore()
  const navigate = useNavigate()
  const { show } = useToast()
  const [tosOpen, setTosOpen] = useState(false)
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [emailSaving, setEmailSaving] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Derive display info
  const login = user?.login ?? ''
  const displayName = user?.name || login
  const isТelegramUser = login.startsWith('@')
  const telegramId = isТelegramUser ? login.slice(1) : null
  const avatar = (user?.name?.[0] ?? login[0] ?? 'U').toUpperCase()
  const balance = user?.balance ?? 0
  const discount = user?.credit ?? 0
  const email = user?.email?.trim() || ''

  const openEmailModal = () => {
    setEmailInput(email)
    setEmailModalOpen(true)
  }

  const handleSaveEmail = async () => {
    const value = emailInput.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      show('Введите корректный email', 'error')
      return
    }
    setEmailSaving(true)
    try {
      await updateEmail(value)
      try {
        const fresh = await fetchProfile()
        setUser(fresh)
      } catch {
        if (user) setUser({ ...user, email: value })
      }
      setEmailModalOpen(false)
      show(email ? 'Email обновлён' : 'Email успешно привязан', 'success')
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Не удалось сохранить email'
      show(typeof msg === 'string' ? msg : 'Не удалось сохранить email', 'error')
    } finally {
      setEmailSaving(false)
    }
  }

  return (
    <div className="space-y-4 animate-fade-in pb-4">

      {/* User card */}
      <div className="rounded-2xl border border-white/10 bg-surface-1 p-4">
        {/* Avatar + name */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-xl font-bold text-white shadow-lg">
            {avatar}
          </div>
          <div>
            <div className="text-base font-semibold text-white">{displayName}</div>
            <div className="text-sm text-slate-400">{login}</div>
          </div>
        </div>

        {/* Info rows */}
        <div className="space-y-0 divide-y divide-white/8 rounded-xl border border-white/8 bg-surface-2 overflow-hidden">
          {/* Telegram ID */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <svg className="h-4 w-4 text-brand-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.19 13.897 4.225 12.99c-.654-.203-.667-.654.136-.968l11.57-4.461c.545-.196 1.021.131.963.66z" />
              </svg>
              Telegram ID
            </div>
            <span className="text-sm text-white font-mono">{telegramId ?? '—'}</span>
          </div>

          {/* Email */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Email
            </div>
            {email ? (
              <button
                onClick={openEmailModal}
                className="truncate text-right text-sm text-white underline-offset-2 hover:underline"
                title={email}
              >
                {email}
              </button>
            ) : (
              <button
                onClick={openEmailModal}
                className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500 transition-colors"
              >
                Привязать
              </button>
            )}
          </div>

          {/* Дата рождения */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              Дата рождения
            </div>
            <span className="text-sm text-red-400">Не указана</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-3 space-y-2">
          <button
            onClick={openEmailModal}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-surface-2 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
          >
            <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            {email ? 'Изменить email' : 'Указать email'}
          </button>
          <button className="flex w-full items-center justify-center rounded-2xl border border-white/10 bg-surface-2 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors">
            Указать дату рождения и получить бонус
          </button>
        </div>
      </div>

      {/* Баланс и статус */}
      <div className="rounded-2xl border border-white/10 bg-surface-1 p-4">
        <h2 className="mb-3 text-base font-semibold text-white">Баланс и статус</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/8 bg-surface-2 px-4 py-3">
            <div className="text-xs text-slate-400 mb-1">Баланс:</div>
            <div className="text-lg font-semibold text-emerald-400">
              {balance.toFixed(2)} <span className="text-sm">₽</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-surface-2 px-4 py-3">
            <div className="text-xs text-slate-400 mb-1">Скидка:</div>
            <div className="text-lg font-semibold text-white">{discount}%</div>
          </div>
        </div>
      </div>

      {/* Navigation list */}
      <div className="space-y-2">
        <MenuRow
          icon={<ReferralIcon />}
          label="Реферальная программа"
          onClick={() => navigate('/referrals')}
        />
        <MenuRow
          icon={<NewsIcon />}
          label="Новости нашего сервиса"
          onClick={() => window.open('https://t.me/djvpnchannel', '_blank')}
        />
        <MenuRow
          icon={<GuideIcon />}
          label="Инструкции"
          onClick={() => show('Раздел в разработке', 'info')}
        />
        <MenuRow
          icon={<SupportIcon />}
          label="Техническая поддержка"
          onClick={() => window.open('https://t.me/help_djvpn', '_blank')}
        />
        <MenuRow
          icon={<DocIcon />}
          label="Правила и условия сервиса"
          onClick={() => setTosOpen(true)}
        />
      </div>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 py-3 text-sm font-medium text-rose-400 hover:bg-rose-500/20 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Выйти
      </button>

      {/* Email modal */}
      {emailModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center animate-fade-in"
          onClick={() => !emailSaving && setEmailModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-white/10 bg-surface-1 p-5 shadow-xl sm:rounded-2xl animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">
                {email ? 'Изменить email' : 'Привязать email'}
              </h3>
              <button
                onClick={() => !emailSaving && setEmailModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-3 text-sm text-slate-400">
              Укажите email — он будет использоваться для чеков и восстановления доступа.
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !emailSaving) handleSaveEmail()
              }}
              placeholder="you@example.com"
              disabled={emailSaving}
              className="w-full rounded-xl border border-white/10 bg-surface-2 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEmailModalOpen(false)}
                disabled={emailSaving}
                className="flex-1 rounded-2xl border border-white/10 bg-surface-2 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveEmail}
                disabled={emailSaving}
                className="flex-1 rounded-2xl bg-brand-600 py-3 text-sm font-medium text-white hover:bg-brand-500 transition-colors disabled:opacity-60"
              >
                {emailSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Terms of Service modal */}
      {tosOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-0 animate-slide-up">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-surface-0/95 px-4 py-4 backdrop-blur-xl">
            <h2 className="text-base font-semibold text-white">Правила и условия сервиса</h2>
            <button
              onClick={() => setTosOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 text-slate-300 hover:bg-white/20 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-300">
              {TOS_TEXT}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function MenuRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-surface-1 px-4 py-4 text-left hover:bg-white/5 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className="text-slate-400">{icon}</span>
        <span className="text-sm font-medium text-white">{label}</span>
      </div>
      <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

function ReferralIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
    </svg>
  )
}

function NewsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
    </svg>
  )
}

function GuideIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  )
}

function SupportIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}
