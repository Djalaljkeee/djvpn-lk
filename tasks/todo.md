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
