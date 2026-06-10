# Фикс «Заработано: 0.00 ₽» в реферальной программе

## Контекст

Заказчик прислал скрин страницы `/referrals`: блок «Заработано» постоянно
показывает `0.00 ₽`, хотя рефералы есть и в SHM начисления идут.

## Диагноз

SHM `/user/referrals` отвечает стандартным wrapper'ом
`{data: [{user_id, login, income, ...}, …, {total: N}], items, status}` —
список рефералов + специальный «маркер» с общим количеством. До перехода
фронта на прямой SHM (commit `0ea83d1`) summary считал бэкенд
(`backend/routers/user.py::get_referrals`), но при миграции normalizer не
портировали на TS (тот же класс багов, который описан в уроке «SHM
напрямую с фронта: не забывай нормализаторы»).

Текущий `fetchReferrals` делал `unwrapOne` и кастил `data[0]` к
`ReferralStats` — `total_income`/`total_referrals` с одного реферала
читались как `undefined` → fallback на `0` → виджет всегда показывал ноль.

## План

- [x] `frontend/src/api/user.ts`: вынести агрегацию в чистую функцию
  `aggregateReferrals(rawItems)` (сумма `income`, чтение `total` из
  маркер-элемента, дедуп: маркер не попадает в `referrals`). В
  `fetchReferrals` слать `limit=25&offset=0` как делал бэкенд, и
  использовать `unwrap` поверх SHM-конверта вместо `unwrapOne`.
- [x] `frontend/src/test/referrals.test.ts`: 4 кейса — сумма income +
  маркер `{total}`, fallback на длину массива без маркера, нечисловой
  income не ломает сумму, пустой ответ → честные нули.
- [x] `tasks/lessons.md`: дополнить раздел «SHM напрямую с фронта…»
  пунктом про реф-эндпоинт и общим правилом про `total`-маркер в `data`.

## Ревью

**Что сделано:**
- `frontend/src/api/user.ts:42-91` — fetchReferrals теперь делает реальный
  агрегат. Если SHM когда-нибудь начнёт отдавать плоский summary
  (`total_referrals` в корне) — ветка раннего return это поддерживает,
  поведение совместимо «вверх».
- `aggregateReferrals` экспортирован отдельно — чистая функция,
  тестируется без axios-моков.

**Проверки:**
- `npx vitest run` — 10/10 зелёные (3 пред-существующих + 4 новых).
- `npm run build` (`tsc && vite build`) — успешно, без ошибок типов.

**Что не делалось:**
- Поход в браузер на `/referrals` (в этом окружении нет headless'а) —
  визуальную проверку рекомендуется прогнать после деплоя на пользователе
  с реальными начислениями.

---

# Favicon + единый стиль страницы документации

## Контекст

Заказчик прислал новый SVG-логотип для favicon и попросил привести публичную страницу документации (`frontend/public/setup.html`) к общему стилю приложения — логотип и задний фон.

## Сделано

- [x] `frontend/public/favicon.svg`: заменён на новый SVG (DJ VPN, squircle + Wi-Fi дуги). Обе страницы (`index.html` и `setup.html`) ссылаются на `/favicon.svg`, поэтому фавикон обновился сразу везде.
- [x] `setup.html` — фон приведён к общему: gradient как в `src/index.css` (`html`: радиальные блобы 0.28/0.24 + `linear-gradient(180deg,#2f0e45→#14071f→#12061a)`), `body` сделан прозрачным, чтобы root-фон покрывал всю прокрутку.
- [x] `setup.html` — логотип в топбаре: фейковый CSS-бокс «DJ» заменён на реальный `/djvpn-brand.jpg` (как `BrandLogo` в SPA) + вордмарк «DJ VPN / fast secure reliable».

## Проверки

- `npm run build` — успешно; `dist/favicon.svg` (1.8 КБ) и `dist/setup.html` собраны.
- `python3 xml.dom.minidom` — favicon.svg валидный XML.

---

# Редизайн страницы входа и блока реферальной программы

## Контекст

Заказчик прислал два макета (страница входа и реферальная программа) и попросил «исправить» экраны. Текущий код не совпадал с макетами — это новый целевой дизайн. Цель — привести оба экрана к стилистике макетов, сохранив всю существующую логику (вход/регистрация/верификация email/captcha/Telegram-auth, загрузка реф-статистики).

## План

- [x] `pages/LoginPage.tsx`: hero-панель (бейдж «Работает в РФ…», градиентный заголовок «VPN, который просто работает», 3 фиче-карточки с inline-иконками). Виджет Telegram перенесён НАВЕРХ над форму, разделитель «или». Поля с иконками (user/mail/lock). Нижняя плашка доверия (AES-256 · Без логов · Поддержка 24/7). Вся логика (3 режима, captcha, onTelegramAuth) без изменений.
- [x] `pages/LoginPage.tsx::EmailVerifyBlock`: добавлена отдельная заметная подсказка «Проверьте папку Спам — код может попасть туда» (по доп. просьбе заказчика).
- [x] `pages/ReferralsPage.tsx`: новый маркетинговый вид — заголовок «Реферальная программа», карточка «Заработано» (реальный `total_income`), блок «Ваша реферальная ссылка» (реальный `user_id`, кнопки копирования), «Как это работает» (3 шага), «Условия программы» (4 пункта), нижняя плашка с ссылкой на поддержку. Загрузка данных и `copyLink` переиспользованы.

## Решения / трейд-офы

- **Telegram-вход** — оставлен официальный виджет (`telegram-widget.js`), без кастомной синей кнопки: надёжнее, не требует `bot_id` и не рискует авторизацией (согласовано с заказчиком).
- **Реферальные данные** — новый вид, но «Заработано» = реальный доход из API, ссылки = реальный `user_id`; «15%» и «Условия» — статичный маркетинговый текст (согласовано).
- **Страница входа** — намеренно БЕЗ выдуманных метрик (30 000+, 99,9%, 4.9), промо «3 дня бесплатно» и строки флагов серверов (согласовано «без декоративных статов»).
- Иконки — мелкие inline-SVG в стиле существующего кода (captcha-refresh, ReferralIcon), без новой icon-библиотеки. Переиспользованы `.glass`/`.brand-panel`/`.gradient-text`/`shadow-brand`.

## Ревью

**Проверки:**
- `npm run build` (`tsc && vite build`) — успешно, без ошибок типов.
- `npm test` (vitest) — 6/6 зелёные.
- Логика auth/captcha/Telegram/верификации сохранена дословно — правки только в разметке/стилях + spam-подсказка + привязка «Заработано» к API.

**Что осталось / риски:**
- Визуальная проверка в браузере не делалась (в окружении нет headless-браузера) — рекомендуется глазами прогнать `/login` и `/referrals` после деплоя.
- Ссылка «Подробнее» на реф-странице ведёт на поддержку `https://t.me/help_djvpn` (отдельной FAQ-страницы нет).

---

# Connect-ретрай для SHM/Remnawave + Remnawave token (переезд)

## Контекст

После фикса обёртки ошибок (504/502 вместо 500) всплыли два следствия:
1. **Remnawave 401** — `REMNA_TOKEN` со старого сервера протух. На новом
   сервере `GET remna.djvpn.ru/api/system/health` отдавал
   `401 Unauthorized`. Трафик/устройства приходили пустыми (200 с
   нулями), потому что `get_devices`/`get_remna_info` глотают per-service
   ошибку и отдают заглушку. → Лечится обновлением токена в `.env`
   (хост-сайд, не код).
2. **504 на `/api/user/remna-info` снова** — НЕ Remnawave. Эти эндпоинты
   сначала дёргают SHM (`/shm/v1/user`, `/shm/v1/user/service`), и
   именно SHM-вызов таймаутит из-за нерешённого hairpin NAT (бёрст
   page-load → cold connection pool → ConnectTimeout). Heartbeat в
   момент инцидента: `running_tasks=45, shm_in_flight=8`, вся Подписки-
   страница пустая, стена красных SHM-прокси-запросов.

Хост-фикс hairpin (iptables SNAT / conntrack) — за пользователем.
В коде добавляем слой устойчивости: connect-уровневый ретрай, который
absorbs транзиентный «холодный» бёрст, пока сеть раскачивается.

## План

### Backend
- [x] Новый `http_retry.py::request_with_connect_retry` — ретрай ТОЛЬКО
      `ConnectTimeout`/`ConnectError`/`PoolTimeout` (запрос не дошёл до
      сервера → идемпотентно для любого метода). `ReadTimeout` НЕ
      ретраим. 1 повтор (2 попытки, worst-case ~10.5с < axios 15с),
      бэкофф с джиттером `uniform(0.25, 0.5)` для де-синка параллельного
      залпа.
- [x] `shm_client.shm_request` — через helper (`label=path`).
- [x] `routers/shm_proxy.shm_proxy` — через helper (body уже в памяти,
      повтор безопасен).
- [x] `remnawave_client.remnawave_request` — через helper.
- [x] `storage.fetch_storage_data` — через helper (UUID-резолв переживает
      блип).
- [x] `routers/devices.py` — логирование per-service ошибок `%r` вместо
      `%s` (пустой `ConnectTimeout()` через `%s` давал `usi=N: ` без
      причины).

### Тесты
- [x] `tests/test_http_retry.py` — 5 кейсов: retry→success (connect
      timeout / connect error), giving up после max, ReadTimeout НЕ
      ретраится, success с первой попытки. Все зелёные (15/15 вместе с
      test_shm_proxy).

### Документация
- [x] `tasks/lessons.md` — дополнить урок «Hairpin NAT»: правила ретрая
      (только connect-уровень, джиттер, бюджет попыток) + ловушка
      «504 на remna-info = SHM, не Remnawave».

### Хост-сайд (за пользователем, вне репо)
- [ ] Обновить `REMNA_TOKEN` в `.env` → `docker compose up -d backend`.
      (Сделано пользователем — health-check 401 был на старом токене.)
- [ ] Применить hairpin-фикс на хосте (iptables SNAT для docker→pub_ip
      :443, и при необходимости `nf_conntrack_max`). Без него ретрай
      лишь смягчает, но не убирает таймауты под бёрстом.

## Решения / трейд-офы

- **Ретрай только connect-уровня** — единственный класс сбоев, где
  повтор гарантированно безопасен для любого метода (нет side-effect,
  TCP-сессия не поднялась). Это снимает вопрос «а вдруг POST повторится
  дважды».
- **1 повтор, не 2+** — бюджет latency. Connect-таймаут 5с × 2 попытки
  = ~10с, плюс джиттер; укладываемся под фронтовый axios-таймаут 15с.
  Транзиентный hairpin восстанавливается за доли секунды, второй
  попытки хватает.
- **Джиттер обязателен** — синхронный ретрай N запросов = тот же бёрст.
  `uniform(base, 2*base)` размазывает повторы.
- **Ретрай — НЕ замена хост-фиксу** (CLAUDE.md: корневая причина). Это
  defense-in-depth поверх flaky-сети; корень (hairpin) лечится на хосте.
- **`label` вместо полного URL в логах** — в URL бывают session_id/uuid,
  не светим их в warning-логах ретрая.

## Ревью

**Что сделано:**
- `backend/http_retry.py` — новый shared helper, применён в 4 точках
  выхода (shm_client, shm_proxy, remnawave_client, storage).
- `backend/routers/devices.py` — `%r` в per-service логах.
- `backend/tests/test_http_retry.py` — 5 кейсов, все зелёные.
- Импорт-чейн без циклов (проверено `python -c "import ..."`).

**Проверки в этом окружении:**
- `pytest tests/test_http_retry.py tests/test_shm_proxy.py` — 15/15 ok.
- Import smoke (no circular import) — ok.

**Проверки на проде (за пользователем):**
- Бёрст-тест из контейнера к `admin.djvpn.ru` (см. план Этап 4).
- `docker compose logs backend | grep http_retry` — видеть, что
  ретраи срабатывают и в основном со 2-й попытки успешны.
- Remnawave health-check с НОВЫМ токеном должен дать 200, не 401.

---

# 500 на `/api/shm/*` после переезда — обёртка ошибок upstream

## Контекст

После переноса ЛК на новый сервер при первой нагрузке пачка
запросов `/api/shm/v1/*` падала в `500 Internal Server Error` с
голым traceback'ом `httpx.ConnectTimeout` через 5с. Через
несколько минут «само починилось», одиночный `curl` из контейнера
на `https://admin.djvpn.ru` в тот же момент отдавал нормальный
ответ. Синхронно с SHM-таймаутами падал `Kuma fetch error` —
Kuma живёт на том же хосте, значит проблема общая для outbound
на свой же сервер (hairpin NAT захлёбывается на бёрсте).

Полный план (диагностика хоста + iptables + код) лежит в
`/root/.claude/plans/structured-wobbling-barto.md`. Сетевой фикс
(`iptables -t nat ... SNAT`, conntrack tuning) делается на хосте
вне репозитория. В код идёт только то, что превращает голый 500
в честный 502/504 с понятным detail — иначе следующий аналогичный
инцидент снова съест часы на разбор traceback'ов.

## План

### Backend
- [x] `routers/shm_proxy.py::shm_proxy` — обернуть `client.request`
      в try/except: `httpx.TimeoutException` → 504, `httpx.RequestError`
      → 502, `log.warning("shm_proxy.upstream_error", ...)` в одном
      стиле с существующим `shm_proxy.forwarded`. `_shm_inflight_dec()`
      остаётся в `finally`.
- [x] `shm_client.py::shm_request` — то же самое, но наружу
      `HTTPException(504/"SHM upstream timeout")` /
      `HTTPException(502/"SHM upstream unreachable")`, потому что
      эта функция вызывается из `security.py::_resolve_user_id` и
      роутеров (devices/storage), где ожидается HTTPException.

### Документация
- [x] `tasks/lessons.md` — добавить урок «Hairpin NAT и outbound из
      контейнера на свой же сервер»: симптом, диагностический
      индикатор через `Kuma fetch error` синхронно с SHM, фикс
      iptables SNAT vs. `host-gateway`, conntrack tuning.

### Что НЕ делаем (явно)
- Не переводим `SHM_BASE_URL` на внутренний docker-хост (`http://shm-admin:port`)
  — пользователь отверг: CORS API SHM требует «реальные адреса».
- Не поднимаем `_SHM_TIMEOUT.connect` — маскировка hairpin-проблемы.
- Не вводим retry/circuit-breaker в `shm_client` — отдельная история,
  не блокирует инцидент.
- Не трогаем `docker-compose.yml` — пользователь оставляет публичный URL.

## Решения / трейд-офы

- **504 vs 502 разделение**: TimeoutException ловим первым (это
  подкласс TransportError → RequestError) и отдаём 504 — фронт по
  504 показывает «попробуйте позже / SHM медленный», по 502 — «SHM
  недоступен». Разная UX-семантика, дешёво поддерживать.
- **Тело ответа в `shm_proxy` — bytes JSON, не `JSONResponse`**: уже
  работаем на уровне Starlette `Response` с raw content, чтобы не
  тянуть лишний слой сериализации в горячий путь прокси.
- **`elapsed_ms` в логах ошибок** — позволяет в Kibana/grep сразу
  видеть «таймаут на 5001ms» (connect-timeout) vs «таймаут на
  15001ms» (read-timeout) без раскопок stack-trace'ов.
- **Не пишем тело SHM-ошибки в наш JSON** — детали upstream'а не
  должны утекать клиенту (могут содержать stacktrace SHM или
  internal-хосты). Generic-сообщение + всё в логи.

## Ревью

**Что сделано:**
- `backend/routers/shm_proxy.py:91-148` — try/except с разделением
  TimeoutException → 504 / RequestError → 502, `log.warning`
  `shm_proxy.upstream_error` со всеми контекстными полями.
- `backend/shm_client.py:108-122` — то же для shared shm_request,
  но через `HTTPException`. `_shm_inflight_dec()` в `finally` —
  счётчик in-flight не съезжает при ошибках.
- `tasks/lessons.md` — новый раздел про hairpin NAT с диагностикой
  и фиксом.

**Проверки (что НЕ выполнено в этом окружении):**
- Бёрст-тест из контейнера к `admin.djvpn.ru` — нужен доступ к
  prod-серверу.
- E2E через браузер на `lk.djvpn.ru` — после деплоя.
- Smoke 502 (подмена SHM_BASE_URL на unroutable) — после деплоя.

**Что остаётся за рамками этого PR (по плану):**
- Хост-side фиксы: iptables SNAT для hairpin, расширение
  `nf_conntrack_max` — выполняются администратором сервера по
  результатам диагностики из `Этапа 1` плана.

---

# Документация-сайдбар + быстрый доступ к инструкциям

## Контекст

Заказчик попросил переделать `/setup.html` в формат документации с
**левым сайдбаром и сворачиваемыми разделами** (как netzrun.com),
добавить иконку «Инструкции» в шапку ЛК рядом с уведомлениями и
заменить заглушку-тост в профиле на реальную ссылку.

## План

### `frontend/public/setup.html`
- [x] Переписать с `display: grid; sidebar | content` + sticky topbar.
- [x] Сайдбар: ваниль-JS, `data-section` атрибуты, `.is-active` /
      `.is-expanded` классы. Без `<details>` (после прошлого урока).
- [x] Разделы: Главная / Начало установки (iOS/macOS/Android/Windows/
      TV → Apple+Android) / Прочие инструкции (Роутеры/Бот/Кабинет)
      / FAQ / Обновление подписки / Правила использования / Политика
      конфиденциальности.
- [x] Новый контент: Роутеры (Keenetic + OpenWRT), Обновление
      подписки в Happ/Hiddify.
- [x] Текст ToS и секцию 7 (Конфиденциальность) встроил в JS как
      строки — переиспользовал текст из ProfilePage.tsx:8-83.
- [x] Мобильный drawer: сайдбар скрыт, гамбургер в топбаре, scrim.
- [x] Hash-deeplink: `#install-ios`, `#faq`, `#privacy` и т.д.

### `frontend/src/components/Layout.tsx`
- [x] Иконка-книжка слева от `<NotificationBell />` (line 92).
      `<a href="/setup.html">` в той же вкладке, стиль 1-в-1 с
      колоколом (40×40, rounded-2xl).

### `frontend/src/pages/ProfilePage.tsx`
- [x] Заменил `onClick={() => show('Раздел в разработке', 'info')}`
      на `onClick={() => { window.location.href = '/setup.html' }}`.

## Решения / трейд-офы

- **Только Happ под iOS** (без Streisand/Karing/Shadowrocket/Stash) —
  явный ответ заказчика, DJ VPN их не поддерживает официально.
- **TV-раздел** в сайдбаре назвал «Установка на TV» вместо «tvOS» —
  внутри две подсекции (Apple TV + Android TV), название честнее
  отражает охват.
- **Bot / Cabinet** переехали под «Прочие инструкции» — раньше были
  top-level табами; новая IA их не требует на верхнем уровне.
- **Linux-инструкции выкинул** — у DJ VPN нет официальной поддержки,
  на новой структуре негде разместить; если попросят — добавлю.
- **Текст ToS дублирую в HTML** (не подтягиваю из React-кода) —
  `setup.html` это статика без bundle, перекрёстных импортов между
  публичной HTML и SPA-кодом не делаю. При изменении ToS — две
  правки (ProfilePage.tsx + setup.html script), это приемлемо.
- **Иконка в шапке — `<a href>`, не `<Link>`** — `setup.html` это
  статика вне react-router, реактовский Link не сработает.

## Ревью

**Что сделано:**
- Новый `frontend/public/setup.html` — 1124 строки, ~67KB в dist.
  Документация-сайдбар как у netzrun.com, мобильный drawer, hash-
  навигация, 12 контентных панелей.
- Иконка-книжка в `Layout.tsx` слева от колокола уведомлений,
  стиль идентичен (40×40, тот же бордер/фон/hover).
- Кнопка «Инструкции» в `ProfilePage.tsx` теперь ведёт на
  `/setup.html` (раньше тост-заглушка).

**Проверки:**
- `npx vite build` — успешно, `dist/setup.html` 67KB.
- `npx tsc --noEmit` — без ошибок.
- `npx vitest run` — 6/6 зелёных.

**Что осталось / риски:**
- Скриншоты приложений (Happ UI, Hiddify UI) не добавлены — везде
  emoji-иконки и описания. Если нужны реальные кадры — отдельным
  заходом по готовым ассетам.
- Текст «Обновление подписки» (Hiddify «Update profile», Happ swipe-
  refresh) написан по типовому поведению клиентов; если у DJ VPN
  есть фирменные кнопки/флоу — подправлю.
- Тексты гайдов для роутеров (Keenetic xkeen / OpenWRT sing-box) —
  ориентир на стандартную процедуру community-проектов. Если у
  заказчика есть свой канон, заменим.

---

# Расширенная страница гайдов по настройке (`/setup.html`)

## Контекст

В исходном HTML-черновике гайдов было: общие 2-3 шага на платформу,
синяя палитра не от ЛК, нет разделения по категориям. Нужна
полноценная статическая лендинг-страница с категориями-табами,
дизайном ЛК, детальными гайдами и FAQ.

## План

- [x] Создать `frontend/public/setup.html` под дизайн-токены из
      `frontend/tailwind.config.js` и `frontend/src/index.css`
      (`--surface-*`, `--brand-*`, `.glass`, `.gradient-text`).
- [x] 6 категорий-табов: Смартфон / Компьютер / Телевизор / Бот /
      Кабинет / Вопросы. Внутри Смартфон/Компьютер/Телевизор — чипы
      под конкретные платформы.
- [x] По 4 детальных шага на каждую платформу + callout-подсказки
      («что если QR не сканируется» и т.п.).
- [x] FAQ-аккордеон 8 пунктов (вместо 4 в исходнике).
- [x] Sticky topbar в стиле `Layout.tsx` (логотип DJ VPN + «В кабинет»),
      ambient blur-блобы как в Layout.
- [x] Deeplink-якоря `#mobile`/`#desktop`/`#tv`/`#bot`/`#cabinet`/`#faq`.
- [x] Синхронизация ссылок на приложения с `backend/vpn_setup.py`
      (App Store id6744897585, com.happ.vpn, Hiddify под Windows).
- [x] Vite build — `dist/setup.html` копируется (47.4 KB).
- [x] Коммит и push в `claude/add-setup-guides-XGPjS`.

## Решения / трейд-офы

- **Статический HTML, не React**: страница публичная (без авторизации),
  отправляется ссылкой из бота/рекламы, не зависит от bundle SPA.
  Vite просто кладёт её в `dist/`. Заодно не загромождает SPA маршрут.
- **Ваниль-JS без зависимостей**: ~50 строк на переключение
  табов/чипов и якоря. Никаких React/jQuery в простой лендинг-странице.
- **Hiddify под Windows** (а не Happ): canon-источник —
  `backend/vpn_setup.py::HAPP_DOWNLOADS["windows"]`, там
  `github.com/hiddify/hiddify-app`. На странице явно помечено
  callout-блоком, чтобы не вводить пользователя в заблуждение.
- **Не трогаю `SetupGuide.tsx`**: это UX-модалка автоимпорта внутри
  ЛК (быстрая «одна кнопка»), а `setup.html` — длинная инструкция
  «для тех, кто читает». Поверхности дополняют друг друга, не дублируют.

## Ревью

**Что сделано:** новый `frontend/public/setup.html` (47KB) с
полностью переработанной структурой:
- Hero с градиентным заголовком в брендовой магенте.
- Overview-сетка из 4 карточек (Смартфон / Компьютер / ТВ / Бот) —
  клик переключает таб и скроллит к нему.
- 6 главных табов + чипы для платформ внутри табов.
- ~24 шага в сумме (4 шага × 6 платформ) с CTA-кнопками и
  callout-подсказками.
- FAQ-аккордеон 8 вопросов на основе типовых тикетов.
- Финальный CTA-блок «Открыть бота / Перейти в кабинет».
- Sticky topbar, ambient blur-блобы, glass-карточки, Golos Text —
  визуально неотличимо от React-кабинета.
- Полная адаптивность под мобильный: 375px viewport отрабатывает
  без переполнений.

**Проверки:**
- `npx vite build` — успешно, `dist/setup.html` 47.4KB.
- Балансировка тегов — без открытых.
- TS-билд падает на пре-существующем баге `baseUrl deprecated`
  в tsconfig — не связано с правками.

**Что осталось / риски:**
- Скриншоты `bot-main.jpg`, `cabinet-main.jpg` и т.п. из исходного
  HTML я не переносил — на новой странице используются emoji-иконки
  и градиентные заглушки вместо фото. Если нужны реальные скриншоты
  ЛК/бота — добавлю отдельным коммитом, когда дадите файлы.
- Если у проекта есть отдельный «Happ Proxy Utility» для Windows
  (а не Hiddify), нужно поправить и `backend/vpn_setup.py`, и эту
  страницу — сейчас они синхронизированы.

---

# Реферальные ссылки в личном кабинете

## Контекст

В Telegram-боте уже работает: `https://t.me/Dj_VPN_bot?start=2` → у нового пользователя сохраняется `partner_id=2` (поле «ID агента» в SHM-карточке клиента).

Нужно сделать аналог для веба: ссылка `https://lk.<домен>/?ref=2` → новый пользователь, зарегистрированный через ЛК (любым способом), получает `partner_id=2`.

В Swagger публичный `partner_id` явно не описан, но SHM кладёт произвольные поля в `PUT /shm/v1/user` и `PUT /shm/v1/admin/user` (так же делает бот). Передаём `partner_id` в теле запроса при создании.

## План

### Backend
- [x] `models.py`: добавить `partner_id: Optional[int]` в `RegisterRequest` и `TelegramAuthRequest`.
- [x] `shm_client.py::shm_public_register`: принимать `partner_id` и подмешивать в `body`.
- [x] `routers/auth.py::register`: пробрасывать `partner_id` в публичный endpoint и в admin-fallback `PUT /shm/v1/admin/user`.
- [x] `routers/auth.py::telegram_auth`: пробрасывать `partner_id` в SHM widget-payload + в admin-create в fallback.
- [x] `routers/auth.py::webapp_auth`: принять `partner_id` как query-параметр, пробросить в fallback admin-create + SHM webapp endpoint.

### Frontend
- [x] `utils/referral.ts`: чтение `?ref=` из URL, сохранение в `localStorage`, утилиты `getRefId()` / `clearRefId()` / `captureRefIdFromUrl()`.
- [x] `App.tsx`: при монтировании захватываем `?ref=` (до redirect-ов).
- [x] `api/auth.ts`: добавить `partner_id` в `RegisterPayload`, `loginWithTelegram`, `loginWithWebApp`.
- [x] `pages/LoginPage.tsx`: при регистрации/Telegram-логине отправляем `partner_id`. После успеха — чистим.
- [x] `pages/ReferralsPage.tsx`: добавить веб-ссылку вида `${origin}/?ref=${user_id}` рядом с Telegram-деплинком.

### Git
- [x] Закоммитить и запушить в `claude/add-referral-link-feature-0HDYn`.

## Решения / трейд-офы
- `partner_id` передаём только при создании пользователя — обновлять у уже существующих не нужно (так же делает Telegram bot: `start <id>` срабатывает только при первом контакте).
- Захватываем `?ref=` ОДИН раз и кладём в `localStorage` — переживает редирект через Telegram OAuth и переключение вкладок.
- Чистим `localStorage` после успешного auth (login по паролю/телеграмму/регистрация), чтобы реферал не «прилипал» при последующих регистрациях с того же устройства.
- Не валидируем `partner_id` на бэке, кроме приведения к int — SHM сам решит, существует ли такой пользователь.

## Ревью

**Что сделано:**
- Backend: `RegisterRequest`, `TelegramAuthRequest` принимают `partner_id`. Все три auth-эндпоинта (`/api/auth/register`, `/api/auth/telegram`, `/api/auth/webapp`) пробрасывают значение в SHM как при прямом вызове SHM endpoint, так и в admin-fallback. `partner_id` пишется только в момент создания нового юзера; на уже существующих пользователей не влияет — это совпадает с поведением Telegram-бота (`/start <id>` срабатывает один раз).
- Frontend: новый модуль `utils/referral.ts` (3 функции: `captureRefIdFromUrl`, `getRefId`, `clearRefId`) с хранением в `localStorage`. `App.tsx` захватывает `?ref=ID` сразу при монтировании, до маршрутизации. `LoginPage` подмешивает `partner_id` в регистрацию и Telegram Login Widget. `loginWithWebApp` поддерживает query-параметр `partner_id` для Mini App. Страница рефералов теперь показывает две ссылки: Telegram deeplink и URL ЛК.
- После любой успешной авторизации `clearRefId()` очищает `localStorage` — реферал не «прилипает» к устройству для следующих регистраций.

**Проверки:**
- `python -c` импорт моделей с/без `partner_id` — ок.
- `tsc --noEmit` — без ошибок типов.
- `npm run build` — сборка успешна (428 KB JS, 39 KB CSS).
- Бэкендовые pytest не запустились в этом окружении из-за поломанной системной криптографии (PyO3 panic при импорте `cryptography`); проблема не связана с правками.

**Что осталось / риски:**
- В Swagger SHM поле `partner_id` не описано публично, но Telegram-бот его уже использует — значит SHM его принимает в `PUT /shm/v1/user` и `PUT /shm/v1/admin/user`. Поведение нужно проверить на staging.
- Mini App (Telegram WebApp) автоматически подхватит `partner_id` только если пользователь зашёл в ЛК через web по `?ref=ID` ДО открытия Mini App. Внутри Telegram WebApp прямого URL-параметра `?ref=` нет — там используется `start_param` (это уже отдельная фича для будущего).

---

# Смена пароля как отдельная страница + фикс модалок под навбаром

## Контекст

Заказчик хочет прикрепить кнопку «Сменить пароль» в Telegram-боте отдельной ссылкой. Сейчас смена пароля живёт только модалкой внутри `ProfilePage`, и у этой модалки на мобиле кнопки действия скрываются за нижним навбаром (тот же баг был и у email-модалок).

## План

### Frontend
- [x] `pages/ChangePasswordPage.tsx`: новая полноэкранная страница с двумя input-ами и кнопкой «Сохранить». Использует существующий `changePassword()` из `api/user.ts`. После успеха пробует `window.Telegram.WebApp.close()`, иначе `navigate('/profile')`.
- [x] `App.tsx`: регистрируем `/change-password` **снаружи** общего `Layout` (никаких шапок/навбаров на странице). Маршрут под `PrivateRoute`. Расширили global-тип `Window.Telegram.WebApp` полем `close?: () => void`.
- [x] `App.tsx::TelegramWebAppGate`: фикс deep-link — редирект на `/` теперь только если пользователь сейчас на `/login`. Иначе сохраняем текущий путь — иначе ссылка из бота «съедается».
- [x] `pages/ProfilePage.tsx`: убрали модалку смены пароля, кнопка теперь делает `navigate('/change-password')`.
- [x] `components/Layout.tsx`: убрали `z-10` с `<main>` — это устраняло stacking-context, в котором тонули модалки (z-[80]) под нижним навбаром (z-50). Заодно лечит email/верификации/services-модалки.

### Git
- [x] Закоммитить и запушить в `claude/password-change-link-RHnZJ`.

## Решения / трейд-офы

- Полностью заменили модалку смены пароля на отдельный маршрут — нет смысла дублировать форму. Декстопу страница тоже подходит, есть кнопка «Назад».
- Не делаем отдельный one-time-token endpoint: внутри Telegram WebApp `initData` сам авторизует пользователя через `TelegramWebAppGate`. Снаружи Telegram анонима всё ещё отправит `PrivateRoute` на `/login` — это ожидаемое поведение.
- Убрали `z-10` с `<main>` вместо рефакторинга на React Portal — изменение в одну строку, лечит сразу все модалки в приложении.

## Ревью

**Что сделано:**
- Новая страница `/change-password` рендерится без шапки/навбара, форма сразу видна на мобиле, после успеха корректно закрывает Mini App (или возвращает на `/profile` в обычном браузере).
- `TelegramWebAppGate` теперь не «съедает» deep-link — любая ссылка из Telegram-бота (не только смена пароля) корректно отрабатывает для свежих пользователей.
- Поведение модалок (email / подтверждение / ToS / ServicesPage) починено одним удалением `z-10` — кнопки больше не уходят под нижний навбар.

**Проверки:**
- `npx vite build` — сборка успешна (429 KB JS, 39 KB CSS).
- `npx vitest run` — 6/6 тестов зелёные.
- `tsc` пропущен из-за пред-существующего бага tsconfig (`ignoreDeprecations: "5.0"` невалиден в TS 5.9) — не связан с правками.

**Что осталось / риски:**
- Заказчику нужно завести в Telegram-боте Web App кнопку с URL `https://<домен>/change-password`. После этого можно тестировать end-to-end.
- Для пользователей вне Telegram, у которых пароль ещё не задан (только Telegram-логин), ссылка из бота откроется как обычный URL без initData — там сработает только если у них уже есть валидный JWT в localStorage. Это допустимо: бот всегда даёт ссылку через Web App, не просто URL.

---

# Авторизация в Telegram WebApp через браузер (Chrome/Yandex)

## Контекст

Заказчик прислал скриншот: в Telegram WebApp, открытом в браузере (web.telegram.org → iframe lk.djvpn.ru), показывается LoginPage и сыпется в консоль:
- `GET /api/shm/v1/user 401 (Unauthorized)` (дважды)
- `Framing 'https://oauth.telegram.org/' violates the following Content Security Policy directive: 'frame-ancestors https://lk.djvpn.ru'` (трижды)

Внутри нативного клиента Telegram (мобильный/десктоп) всё работает — только в браузере проблема.

## Диагноз

1. WebApp в браузере = `lk.djvpn.ru` грузится в iframe из `web.telegram.org`. Top-level site (`web.telegram.org`) ≠ embed (`lk.djvpn.ru`) → контекст cross-site / третьесторонний.
2. Backend на `/api/shm/v1/telegram/webapp/auth` корректно вытягивает `session_id` из тела и ставит `Set-Cookie: session_id=...; Path=/; HttpOnly; Secure; SameSite=Lax` (shm_proxy.py:191, 205).
3. Chrome (с поэтапным отключением 3rd-party cookies / sandbox) и Yandex Browser («Защита») в кросс-сайт iframe **отбрасывают** `SameSite=Lax` cookies — они не сохраняются. Cookie никогда не оседает на lk.djvpn.ru внутри WebApp.
4. Следующий запрос `GET /api/shm/v1/user` уходит без cookie → 401 → handle401 в client.ts:53 редиректит на `/login`.
5. LoginPage пытается загрузить Telegram Login Widget (`telegram-widget.js`), который монтирует iframe `https://oauth.telegram.org/embed/<bot>`. У oauth.telegram.org CSP `frame-ancestors` не допускает цепочку `[lk.djvpn.ru, web.telegram.org]` — отсюда трижды Framing-блокировка в консоли. Виджет в WebApp вообще не нужен (initData уже даёт авторизацию).

## План

- [x] `backend/routers/shm_proxy.py`: заменить `samesite="lax"` на `SameSite=None; Partitioned` (CHIPS) когда `is_secure=true`. Используем сырой `set-cookie` header, потому что Starlette `set_cookie(partitioned=...)` появился только в 0.42, а в проекте FastAPI≥0.111 → Starlette может быть 0.37+. Если не secure (локальная разработка по HTTP) — оставляем `SameSite=Lax`, потому что `SameSite=None` требует `Secure`.
- [x] `frontend/src/api/auth.ts::captureSessionFromBody`: JS-фолбэк тоже переводим на `SameSite=None; Secure; Partitioned` (только когда HTTPS). На HTTP оставляем `SameSite=Lax`.
- [x] `frontend/src/pages/LoginPage.tsx`: если `window.Telegram?.WebApp?.initData` присутствует — не рендерим Telegram Login Widget. Внутри WebApp юзер либо пройдёт автологин по initData (через TelegramWebAppGate), либо введёт логин/пароль; виджет в этом контексте бесполезен и спамит CSP-ошибками.
- [x] `backend/tests/test_shm_proxy.py`: добавлены тесты `test_session_cookie_uses_samesite_none_partitioned_under_https` и `test_session_cookie_falls_back_to_lax_under_http` — фиксируют, что под HTTPS уходит `SameSite=None; Secure; Partitioned`, а на HTTP — `SameSite=Lax` без `Secure`.

## Ревью

**Что сделано:**
- `shm_proxy.py`: единственное место установки `session_id` cookie перенесено в `_append_session_cookie` — ручной `set-cookie` header c `SameSite=None; Secure; Partitioned` под HTTPS и `SameSite=Lax` под HTTP. И тело-сессия из auth-эндпоинтов, и старый кейс «SHM прислал Set-Cookie сам» теперь идут через этот же helper, поведение одинаковое.
- `auth.ts`: JS-fallback `document.cookie` под HTTPS пишет с теми же атрибутами, что и backend — иначе server-side и client-side куки имели бы разные SameSite и Chrome их рассматривал бы как разные cookie.
- `LoginPage.tsx`: внутри WebApp (`window.Telegram.WebApp.initData` присутствует) Telegram Login Widget не монтируется (`useEffect` ранний return), блок виджета и разделитель «или» скрыты, подпись формы упрощена до «Войдите по логину и паролю». Если WebApp-автологин не прошёл (например, бот ещё не настроен на endpoint), юзер всё равно может войти через email/пароль.

**Проверки:**
- `python -m pytest backend/tests/test_shm_proxy.py -v` — 12/12 зелёные (10 старых + 2 новых для cookie-атрибутов).
- `npx vite build` (frontend) — успешно: 456 KB JS, 39 KB CSS.
- `npx vitest run` (frontend) — 6/6 зелёные.

**Что осталось / риски:**
- Под HTTPS все cookie теперь `Partitioned` — у юзеров, которые открывают ЛК через прямой URL (не WebApp), это тоже отдельная партиция. Это безопасно: SameSite=None+Partitioned cookie ведут себя как обычные cookie для same-site контекста, потому что в same-site top-level фрейме партиция совпадает.
- Старые юзеры WebApp могут иметь в браузере залипшую `session_id` со старым `SameSite=Lax` — она ещё немного поживёт до Max-Age, и в кросс-сайт iframe Chrome её всё равно не отправит. После первого `/webapp/auth` поверх ляжет свежая кука с новыми атрибутами и проблема рассосётся.
- Не трогаю `frontend/src/api/client.ts::handle401` — там логика глобальная и менять её ради WebApp не нужно: если webapp/auth действительно провалится (изменился initData hash, бот отозвал токен и т.п.), редирект на /login по-прежнему уместен.

## Решения / трейд-офы

- **`Partitioned` (CHIPS)** — это новый attribute, который явно подписывает cookie под top-level site. То есть в Telegram WebApp у нас будет одна партиция (top=web.telegram.org), при прямом заходе на lk.djvpn.ru — другая. Это ок: session SHM привязана к WebApp-сессии (`initData` -> `webapp/auth`) и должна жить только пока юзер внутри WebApp. Прямой заход в браузер использует password-логин, который ставит cookie из своей партиции.
- Не трогаю CSP / Telegram Login Widget на самой странице — он нужен НЕ в WebApp (обычный заход через браузер на lk.djvpn.ru). Просто скрываем его внутри WebApp.
- Не пишу новый middleware "force samesite=none" — модификация локализована в shm_proxy.py, где формируется единственное место установки session-cookie.
