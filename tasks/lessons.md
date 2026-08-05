# Уроки

## `<summary>` + `display: flex` ломает `<details>` в старых Safari/Chromium

- Симптом: FAQ-аккордеон визуально на месте, курсор-pointer, hover есть,
  но клик не переключает `open` — блок не открывается. На iOS Safari < 17
  и Chromium < 89 любое `display`, отличное от дефолтного `list-item`
  (`flex`, `grid`, `block`), на самом `<summary>` ломает нативный toggle.
- НЕ ставь `display: flex/grid/block` прямо на `<summary>`. Если нужен
  flex-layout с иконкой справа — позиционируй `::after` абсолютно
  (`position: absolute; right: 0; top: 50%; transform: translateY(-50%)`)
  и оставь summary в дефолтном `list-item`. Или оборачивай контент в
  `<span>` и навешивай flex на span.
- `list-style: none` + `summary::-webkit-details-marker { display: none }`
  — этого достаточно, чтобы убрать дефолтный треугольник. `display`
  трогать не нужно.
- Тот же баг лечится «на современных браузерах», но Safari 16 ещё
  заметная доля; для публичного лендинга безопаснее не полагаться.

## Публичные лендинги — `frontend/public/*.html`, не React-страницы

- Если страница должна быть доступна **без авторизации** (например,
  ссылка из Telegram-бота для рекламы инструкций), не делай её
  React-роутом под `PrivateRoute`/`Layout` — выноси в
  `frontend/public/<name>.html`. Vite копирует `public/` в `dist/` как
  есть, URL получится `https://<домен>/<name>.html`.
- Без React-обвязки → меньше bundle, нет лишнего auth-flow.
- Чтобы дизайн совпадал с SPA, **извлекай токены из реальных файлов**,
  а не выдумывай: `frontend/tailwind.config.js` (`brand-*`, `surface-*`),
  `frontend/src/index.css` (`.glass`, `.gradient-text`, `.brand-panel`,
  скроллбар), `frontend/src/components/Layout.tsx` (sticky header,
  ambient blobs). Один раз вытащил палитру — пиши обычным CSS с
  `var(--brand-500)` и т.п.
- Шрифт грузи отдельным `<link>` на Google Fonts (Golos Text) — точно
  как в `frontend/index.html`. Без него страница «съезжает» в Arial.
- Категорный таб-навигатор + sub-chips удобно собрать ваниль-JS
  (~50 строк): `data-tab`/`data-sub` атрибуты, `is-active` класс,
  `history.replaceState('#tab-name')` для deeplink-якорей.
- Имена / ID приложений в сторах синхронизируй с
  `backend/vpn_setup.py::HAPP_DOWNLOADS` — иначе лендинг и реальный
  deeplink в боте/ЛК разойдутся. У DJ VPN под Windows используется
  Hiddify (`github.com/hiddify/hiddify-app`), не Happ — частая
  ошибка при копировании инструкций «из памяти».
- У Happ в App Store **две** карточки с разными app-id: Apple по
  требованию РКН удаляла клиент из российской витрины, разработчик
  перезаливал его под новым именем и новым id. Отсюда
  `APPSTORE_HAPP_RU` (`Happ — Proxy Utility+`) и `APPSTORE_HAPP_INTL`
  (`Happ — Proxy Utility`) в `backend/vpn_setup.py` — синхронизировать
  надо обе, и обе продублированы в `setup.html` (iOS + macOS).
  «Безвитринная» ссылка `apps.apple.com/app/id…` тут не выручает: это
  разные приложения, а не одно в разных странах. RU-id исторически
  протухает после каждой чистки — жди следующего перезалива.

## SHM API: undocumented поля

- В Swagger описаны не все поля, которые принимает SHM. Например, `partner_id`
  отсутствует в схеме `User`, но и публичный `PUT /shm/v1/user`, и
  admin `PUT /shm/v1/admin/user` его принимают (этим пользуется Telegram-бот
  через `/start <id>`).
- При интеграции с SHM сверяйтесь с реальным поведением (логи бота / dev-инстанс),
  а не только со Swagger.

## SHM-роутер: `args` в описании роута — это дефолты, а НЕ whitelist

- В `app/public_html/shm/v1.cgi` аргументы метода собираются как
  `%args = ( %{ $p->{args} || {} }, %in, admin => $admin_mode )`, где `%in` —
  всё, что прислал клиент (query + автоматически распарсенный JSON-body).
  Значит любое поле долетает до контроллера, даже если его нет в `args`.
- Практический вывод: `partner_id` можно слать в любой роут, чей контроллер
  его читает. Но обратная сторона важнее — **дефолты из `args` реально
  применяются**, и если флаг там `=> 0`, поведение по умолчанию выключено,
  пока клиент явно не пришлёт `1`. Именно так ломалась регистрация через
  Telegram-виджет (см. ниже).
- Перед интеграцией с новым SHM-эндпоинтом читай ОБА места: описание роута в
  `v1.cgi` (дефолты, `required`, `skip_check_auth`) и сам метод контроллера
  (какие ключи он вообще смотрит). Swagger тут не источник правды.

## Telegram Login Widget: без `register_if_not_exists=1` регистрации нет

- `Core::Transport::Telegram::web_auth` создаёт пользователя ТОЛЬКО внутри
  `if ( !$user && $args{register_if_not_exists} )`, а роут `/telegram/web/auth`
  задаёт дефолт `register_if_not_exists => 0`. Фронт флаг не слал → новый
  Telegram-аккаунт не регистрировался никогда.
- Симптом коварный: подпись виджета проходит, SHM отвечает **HTTP 200** с телом
  `{"data":[null],"status":200}` (в ветке «user not found» вызывается только
  `logger->error`, но не `report->error`, поэтому 4xx не формируется). Сессии в
  теле нет → прокси не ставит `session_id` → следующий `GET /user` ловит 401 →
  интерцептор разлогинивает и показывает generic «Ошибка авторизации».
- Дополнительный ущерб: каждая неудача дёргает
  `set_user_fail_attempt('web_auth', 3600)`, а диспетчер `v1.cgi` при
  счётчике ≥ 5 отдаёт `429` на час по ключу `<класс>-<метод>-<ip>`. Пока
  реальный IP теряется на upstream-Caddy (см. урок про `{client_ip}`), это
  общий счётчик на ВСЕХ пользователей ЛК сразу.
- `partner_id` для виджета читается в том же блоке регистрации
  (`$args{partner_id} ? (partner_id => $args{partner_id}) : ()` в `user->reg`),
  т.е. применяется строго при создании юзера — ровно наша модель рефералов.
- Правило шире одного бага: **если SHM-эндпоинт может вернуть 200 без сессии,
  проверяй наличие `session_id` в теле сам** (`requireSession` в `api/auth.ts`).
  Иначе ошибка авторизации маскируется под 401 на следующем запросе и уводит
  диагностику в сторону «протухшей cookie».
- `webapp_auth` (Mini App) пользователей НЕ регистрирует вообще: нет юзера —
  `undef`, и `partner_id` там игнорируется. Внутри Telegram аккаунт создаёт бот
  по `/start`, поэтому реферал в Mini App приходит только через deeplink.

## Telegram deeplink: `?start=` — это base64url от `k=v&k=v`, ключ `pid`

- SHM разбирает аргумент `/start` так:
  `for my $pair ( split /&/, decode_base64url( $args[0] ) )`, затем
  `$args{partner_id} //= $start_args{pid}` в `shmRegister`. То есть ссылка
  должна выглядеть как `https://t.me/<bot>?start=<base64url("pid=2")>` →
  `?start=cGlkPTI`.
- Голый числовой `?start=2` декодируется в мусор, пары `key=value` не даёт,
  `pid` не находится — реферал теряется **молча**, без ошибок в логах.
  Формулировка «бот использует `/start <id>`» из старых заметок устарела:
  base64url-формат в SHM с 22.01.2025.
- Padding `=` обязательно срезать: Telegram допускает в start-параметре только
  `A-Za-z0-9_-` (до 64 символов), а `MIME::Base64::decode_base64url` добивает
  padding сам. Хелпер — `frontend/src/utils/referral.ts::encodeStartPayload`.
- Тем же механизмом в SHM приезжают `utm_*`-метки (`shmRegister` складывает всё
  с префиксом `utm_` в settings) — можно добавлять в тот же payload.

## Капча SHM stateless: нужны `captcha_token` + `captcha_answer`

- `GET /user/captcha` отдаёт `{image, token}`, где `token =
  base64url(sha256(answer|secret)|timestamp|hmac)`, TTL 5 минут. Ответ зашит в
  сам токен — cookie/сессия к капче отношения НЕ имеет (частое заблуждение).
- `reg_api_safe` проверяет пару через
  `verify_captcha( token => $args{captcha_token}, answer => $args{captcha_answer} )`,
  а `verify_captcha` возвращает 0, если хоть одно поле undefined.
- Мы слали `captcha` / `captcha_code` и вообще выбрасывали `token` из ответа
  (`fetchCaptcha` читал только `image`). При
  `billing.allow_user_register_captcha = 1` это 403 `Invalid captcha` на КАЖДОЙ
  регистрации; при выключенном флаге — поле капчи в UI просто бутафория, и
  баг сидит тихо до момента, когда флаг включат.
- После неуспешной регистрации капчу надо перегенерировать: токен одноразовый
  по смыслу и живёт 5 минут.

## Ошибки SHM приходят в поле `error`, не `detail`

- Прокси `/api/shm/*` отдаёт тело SHM как есть, а SHM формирует ошибки как
  `{"status":400,"error":"Login already in use"}`. Фронт читал только
  `e?.response?.data?.detail` (формат FastAPI) — пользователю всегда показывался
  generic-текст, а реальная причина терялась.
- Хелпер: `error` → `detail` → `e.message` → fallback. `e.message` нужен для
  ошибок, которые бросает сам клиент (например «200 без сессии»).

## Реферальные ссылки в SPA

- Захватывать `?ref=ID` нужно **до** маршрутизации/редиректов: лучше прямо
  в `App.tsx` при первом рендере, иначе Telegram OAuth-редирект на /login
  «съест» query-параметр.
- Хранить в `localStorage` (не в state/zustand) — переживает все навигации
  и обновление страницы. После успешной регистрации/авторизации обязательно
  чистить, иначе ref «прилипнет» к устройству для всех будущих регистраций.
- На бэке писать `partner_id` ТОЛЬКО при создании пользователя. Для уже
  существующих юзеров проброс игнорируется (так делает Telegram-бот:
  deeplink имеет смысл только при первом контакте).
- Захват из URL должен быть **одноразовым за загрузку страницы**. `App.tsx`
  зовёт `captureRefIdFromUrl()` в теле рендера, а URL мы намеренно не чистим —
  значит без флага-однократности любой повторный рендер после `clearRefId()`
  возвращает `partner_id` обратно в localStorage, и ref «прилипает» к
  устройству. Именно тот сценарий, который этот же урок запрещает.
- В компоненте-редиректе (`/r/:id` → `<Navigate to="/">`) писать ref НУЖНО
  в теле рендера, а не в `useEffect`: эффекты дочернего `<Navigate>`
  выполняются РАНЬШЕ эффектов родителя, то есть навигация стартует до записи.
  Сейчас спасает только дофлашивание passive effects перед следующим
  рендером — гонка на ровном месте. `saveRefId` идемпотентен, побочный эффект
  в рендере тут безопасен (в т.ч. при double-render в StrictMode).

## Stacking-context ловушка для модалок

- Если у layout-контейнера (`<main>`, `<section>` и т.п.) выставлены одновременно
  `position` (relative/sticky/fixed/absolute) **и** `z-index`, он создаёт новый
  stacking-контекст. Любая `fixed`-модалка-потомок ограничена этим контекстом —
  даже её `z-[80]` не «пробьёт» соседа layout-а с `z-50` (например, нижний
  навбар).
- Симптом: на мобиле кнопки модалки визуально оказываются под фиксированным
  навбаром, хотя у модалки z-index выше.
- Лечение: либо снять `z-index` с layout-контейнера (оставить только `position`,
  если он реально нужен), либо рендерить модалки через React Portal в `document.body`.
- Особое внимание на `<main className="relative z-10">` — самый частый источник
  бага в SPA на Tailwind.

## Deep-link в Telegram WebApp

- `TelegramWebAppGate` нельзя безусловно `navigate('/')` после успешной
  initData-авторизации — ссылка вида `/change-password` (или любой другой
  shareable URL из бота) будет «съедена» редиректом.
- Правило: редирект на `/` делать только если пользователь сейчас на `/login`.
  В остальных случаях оставляем `location.pathname` как есть.
- Для отдельных страниц вроде смены пароля удобно регистрировать маршрут
  **снаружи** общего `Layout` (без шапки и нижнего навбара) — на мобиле
  получаешь полноэкранную форму, и заодно нечему перекрывать кнопки.
- После успешного действия — пробуем `window.Telegram?.WebApp?.close()`
  (закроет Mini App), иначе fallback `navigate('/profile')`. Тип `close`
  нужно добавить в `declare global` для `Window.Telegram.WebApp`, иначе TS
  ругается.

## Rate-limit за обратным прокси в Docker

- Когда FastAPI/uvicorn стоит за nginx (или любым прокси) в docker, ASGI
  `request.client.host` — это IP контейнера прокси, **один на всех клиентов**.
  Любой rate-limit по IP (slowapi `get_remote_address`, кастомный key_func)
  без разворачивания `X-Forwarded-For` превратится в общий лимит на всех
  пользователей сразу.
- Лечение — `app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")`
  из `uvicorn.middleware.proxy_headers`. Подменяет `scope["client"]` ещё на
  ASGI-уровне → автоматически чинит и slowapi, и access-логи.
- Преимущество middleware перед CMD-флагом uvicorn `--proxy-headers`: работает
  и в юнит-тестах через `TestClient` (там uvicorn не запускается, флаги CMD
  не применяются), и в проде.
- `trusted_hosts="*"` безопасно только если backend-порт **не светится
  наружу**: в docker-compose биндить публикацию на loopback —
  `"127.0.0.1:8000:8000"`. Иначе клиент извне сможет подделать
  `X-Forwarded-For` и обойти rate-limit.
- На стороне nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
  (стандартная переменная, корректно склеивает цепочку прокси) плюс
  `X-Forwarded-Proto $scheme;`.

## SHM auth для Telegram — login-first через публичный API

- **Не используйте admin search для проверки существования юзера.**
  В проде `GET /shm/v1/admin/user?login=@{tg_id}` нестабилен: возвращает
  ~15KB выборку, в которой запрошенного юзера может НЕ быть, хотя
  ручной `GET /shm/v1/user` (Basic-auth от его имени) подтверждает
  что `login` точный. Фильтр `?login=` либо игнорируется, либо
  работает по непредсказуемому паттерну.
- Надёжный алгоритм для TG-логина: сначала `POST /shm/user/auth.cgi`
  с `(@{tg_id}, tg_user_password(tg_id))`. 200 — юзер есть и пароль
  детерминированный. 401 — либо нет, либо пользователь сам менял
  пароль (через UI/email-флоу).
- На 401 — `PUT /shm/v1/user` (публичный endpoint, тот же который
  используют для email-регистрации). Для TG-регистрации email и
  captcha не нужны — SHM принимает payload `{login, password, name,
  partner_id?}` без них.
- Если PUT ответил «already exists» — это рассинхрон пароля. Без
  admin API авто-восстановить нельзя; возвращаем клиенту понятную 401
  «пароль изменён, войдите вручную», а не raw-текст SHM.
- `shm_public_register` после правки принимает `email` опционально —
  один helper покрывает и email-, и TG-регистрацию.
- При создании SHM принимает поле `name`, но при чтении возвращает
  `full_name`. Это разные имена в read/write API SHM (легко промахнуться
  при нормализации ответа).
- Юзер, привязавший email, хранится в SHM с `login = "@{tg_id}"` и
  `login2 = "email@..."` — основной login не меняется на email.

## SHM auth: session-token в body, не в Set-Cookie

- `POST /shm/v1/user/auth` (и `/telegram/web/auth`, `/telegram/webapp/auth`)
  отвечают `200 {"id":"<session>"}`. **Set-Cookie SHM не выставляет** —
  это видно по пустым cookies на lk.djvpn.ru после успешного 200 и по
  упавшему следующему `GET /user → 401`.
- Прокси `/api/shm/*` обязан явно вытащить `id` из тела auth-эндпоинтов и
  сам выставить `Set-Cookie: session_id=<id>; Path=/; HttpOnly; SameSite=Lax`.
  Без этого ЛК зависает на login: фронт думает «авторизовался», следующий
  запрос летит без cookie.
- Парсим body только на whitelisted-путях. Если просто читать `id` из всех
  200-ответов, в cookie уедет user_id с какого-нибудь `/v1/user/<x>`.
- Старый код пытался переписать `Set-Cookie` от upstream — это рудимент
  старой версии SHM. Оставлен как fallback на случай, если SHM где-то
  всё ещё ставит cookie сам; вреда не приносит (Path=/, своя secure-логика).
- Диагностика: `docker compose logs backend | grep shm_proxy.cookies` —
  должно показывать `upstream_set_cookie_count=0` и
  `body_session_id_present=true` на auth-вызовах.
- **Имя поля в теле непостоянно**: `POST /user/auth` отдаёт `{"id": "..."}`,
  а `GET /telegram/webapp/auth` (и telegram-widget `/telegram/web/auth`) —
  `{"session_id": "..."}`. Extractor обязан пробовать оба ключа в порядке
  `session_id, id`, иначе один из путей ломается тихо: 200 OK, кука
  пустая, следующий `/user` → 401.

## SHM password reset: ошибки прилетают со статусом 200 в поле `msg`

- Флоу сброса пароля в SHM (`danuk/shm`, `app/public_html/shm/v1.cgi` +
  `app/lib/Core/User.pm`):
  - `POST /shm/v1/user/passwd/reset` — `{email}` **или** `{login}`,
    `skip_check_auth`. Шлёт письмо со ссылкой `…?token=<35-симв>` (либо
    событие `USER_PASSWORD_RESET`, если `cli.use_for_reset_password`
    выключен). **Всегда 200**, даже «User not found» / «User is blocked»
    — удобно для anti-enumeration, на фронте показываем нейтральное
    «если аккаунт есть — письмо отправлено».
  - `GET /shm/v1/user/passwd/reset/verify?token=` — проверка токена.
  - `POST /shm/v1/user/passwd/reset/verify` — `{token, password}` — смена.
- **Грабли**: verify/reset возвращают «Invalid token» / «Token expired»
  с тем же HTTP 200 — статус НЕ индикатор. Признак успеха/ошибки лежит
  в `data[0].msg` (`'Password reset successful'` vs тексты ошибок). Если
  полагаться на `try/catch` по HTTP-коду, ошибка пройдёт молча (тот же
  класс багов, что в уроке про нормализаторы ниже). Парси `msg`.
- Эндпоинт принимает и email, и login: на фронте шлём по одному ключу
  (email-подобную строку → `{email}`, иначе `{login}`) — SHM ищет и по
  логину, и по email в профиле, попадание полное.

## SHM напрямую с фронта: не забывай нормализаторы

- При переводе фронта с backend-аггрегатора (`/api/dashboard`) на прямой
  SHM API весь `backend/normalizers.py` уехал «за борт», но его никто не
  портировал на TS. Симптомы:
  - На дашборде пропала подписка: `services.filter(s => s.status === 1)`
    фильтрует число, а SHM отдаёт строку `"ACTIVE"`.
  - В профиле «Не подтверждён», хотя SHM присылает `email_verified: 1` —
    TS сравнивал `=== true` с числом.
  - В каталоге пропал service_id: SHM /service/order использует `id`,
    а фронт читает `o.service_id`.
  - На странице рефералов «Заработано: 0.00 ₽» при наличии рефералов:
    SHM `/user/referrals` отдаёт `{data:[{user_id,login,income,...},
    ..., {total: N}]}` (массив рефералов + маркер «общее число»), а
    `fetchReferrals` делал `unwrapOne` и читал `total_income`/
    `total_referrals` с одного реферал-объекта — там этих полей нет, в
    UI летел 0 (см. фикс в `frontend/src/api/user.ts::aggregateReferrals`).
- Лечение: `frontend/src/utils/normalizers.ts` дублирует логику
  `normalize_user_service` / `normalize_catalog_service` /
  `normalize_payment` / `normalize_user`. Применяется в API-функциях
  один раз — компоненты остаются на «нашей» форме.
- Правило: если backend нормализовал поля до миграции, при перехо́де на
  прямой вызов **сразу** портируй нормализатор на TS, а не «потом
  починим UI». UI потом не починят.
- Грабли с агрегатами SHM: эндпоинты со списками (`/user/referrals`,
  возможно и другие) кладут общий `total` отдельным элементом массива
  `data`, а не в обёртку рядом с `items`. `unwrapOne` поверх такого
  ответа возвращает либо первый реферал, либо сам маркер `{total:…}` —
  оба бесполезны для UI. Всегда `unwrap` весь массив и считай агрегаты
  самостоятельно; верь только полям, которые сам нормализовал.

## Hairpin NAT и outbound из контейнера на свой же сервер

- Если backend в docker-compose ходит на публичный URL сервиса,
  который сам обслуживается Caddy/nginx на том же хосте (например,
  `https://admin.djvpn.ru` при том, что SHM admin живёт в соседнем
  контейнере), трафик идёт через hairpin NAT: контейнер → docker
  SNAT → публичный IP сервера → обратно Caddy → upstream-контейнер.
- Симптом: одиночный `curl` из контейнера на этот URL проходит, а
  бёрст 5+ параллельных запросов через `httpx.AsyncClient` падает
  ровно через 5с в `httpx.ConnectTimeout` (`connect_tcp` не
  отвечает). Через несколько минут «само починилось». В логах
  бэкенда — голый `500 Internal Server Error` без detail.
- Диагностический индикатор, что это hairpin, а не SHM-проблема:
  ВСЕ outbound на свой же хост падают синхронно. Если в той же
  миллисекунде, что и SHM-таймаут, появляется `Kuma fetch error`
  (а Kuma живёт на том же хосте) — это общий сетевой путь, а не
  конкретный upstream.
- Прямой фикс на хосте — явный SNAT для трафика из docker-подсети
  на свой публичный IP:
  ```bash
  iptables -t nat -A POSTROUTING -s <docker_subnet> \
    -d <pub_ip> -p tcp --dport 443 -j SNAT --to-source <pub_ip>
  ```
  Source IP сохраняется как публичный — это важно, если upstream
  завязан на «реальные адреса» (CORS / IP whitelist).
- Альтернатива `extra_hosts: admin.djvpn.ru:host-gateway` уводит
  трафик на docker-bridge IP хоста, минуя hairpin совсем. Source IP
  для upstream становится `172.x.x.x` — применимо только если
  upstream НЕ проверяет реальный публичный IP клиента.
- Дополнительный фактор — переполнение conntrack: `dmesg | grep
  nf_conntrack` покажет `table full, dropping packet`. Лечится
  `sysctl -w net.netfilter.nf_conntrack_max=262144`.
- На уровне приложения ОБЯЗАТЕЛЬНО ловить `httpx.TimeoutException`
  и `httpx.RequestError` в proxy/client и превращать в `504`/`502`
  с JSON-detail — иначе диагностика занимает часы вместо минут.
  Логировать через `log.warning("shm_proxy.upstream_error",
  error=type(exc).__name__, path=path, elapsed_ms=...)` рядом с
  существующим `shm_proxy.forwarded`.
- Connect-уровневый ретрай (`http_retry.request_with_connect_retry`)
  — корректный слой устойчивости поверх flaky-пути, НЕ замена хост-
  фиксу. Ретраить можно ТОЛЬКО `ConnectTimeout`/`ConnectError`/
  `PoolTimeout`: они означают, что TCP-сессия не установилась и запрос
  не дошёл до сервера → повтор идемпотентен для ЛЮБОГО метода (даже
  POST/DELETE). `ReadTimeout` ретраить НЕЛЬЗЯ — запрос мог быть уже
  обработан. Бэкофф ОБЯЗАТЕЛЬНО с джиттером: без него N параллельных
  запросов падают и ретраятся синхронным залпом — тем же бёрстом,
  что положил соединения. Число попыток держать в рамках фронтового
  таймаута (axios 15с): при connect-таймауте 5с это максимум 2 попытки.
- Симптом, который путает: `/api/user/remna-info` и `/api/user/devices`
  отдают 504, и кажется, что виноват Remnawave. На деле эти эндпоинты
  СНАЧАЛА дёргают SHM (`/shm/v1/user`, `/shm/v1/user/service`), а все
  Remnawave-вызовы обёрнуты в per-service `except` → возвращают пустой
  объект и 200. Значит 504 на этих путях = SHM-таймаут, НЕ Remnawave.
  Remnawave-сбой проявляется как пустые данные (нули трафика/устройств)
  при 200, а не как 5xx.

## SHM `/v1/user/captcha` — это JSON, а не картинка

- Симптом: `<img src="/api/shm/v1/user/captcha?_=ts">` рендерит
  broken-image placeholder. В DevTools запрос зелёный (200 OK),
  Content-Length ненулевой, в Console — тишина.
- Реальный формат ответа SHM:
  ```
  Content-Type: application/json; charset=utf-8
  Body: {"TZ":"Europe/Moscow","data":[{"image":"PHN2Zy...(base64-SVG)"}]}
  ```
  Браузер видит `application/json` на `<img src>` и молча отказывается
  интерпретировать тело как картинку. Никаких ошибок в Console — это
  тихий fail рендеринга image.
- Лечение: фронт делает **честный** `fetch` через axios (`shm.get(
  '/user/captcha')`), разворачивает SHM-конверт (`unwrapOne` →
  `data[0]`), декодирует base64 в data: URL и кладёт его в `<img src>`:
  ```ts
  const item = unwrapOne<{ image?: string }>(await shm.get('/user/captcha'))
  return { image_url: `data:image/svg+xml;base64,${item.image}` }
  ```
  Backend-прокси трогать не нужно — он честно прокидывает что прислал
  SHM, и заодно сохраняет `Set-Cookie: session_id`, которой SHM связывает
  капчу с последующим `PUT /user`.
- НЕ путать с CORS-ловушкой `crossOrigin="use-credentials"` (см. ниже):
  убрать атрибут — необходимое условие для same-origin картинок, но при
  JSON-обёртке оно не решит проблему: даже после правильных CORS-
  заголовков `<img>` всё равно не отрендерит JSON как PNG/SVG.
- Диагностика будущих «200 OK, картинка broken»: ВСЕГДА смотреть
  `Content-Type` и первые 16 байт тела. `89 50 4e 47` = PNG,
  `ff d8 ff` = JPEG, `47 49 46` = GIF, `3c 73 76 67` = SVG, `7b 22` =
  `{"` (JSON-обёртка, нужен декодер).

## `<img crossOrigin="use-credentials">` ломает same-origin картинку

- Симптом отдельной ловушки: даже если SHM отдаёт настоящий PNG/SVG в
  бинаре, `<img crossOrigin="use-credentials">` на same-origin URL
  переводит загрузку в CORS-режим, шлёт `Origin: <lk>`, требует
  `Access-Control-Allow-Origin` в ответе. Наш `CORSMiddleware`
  (main.py) для same-origin lk-домена ACA-O не выставляет (он не в
  `ALLOWED_ORIGINS`, и same-origin CORS считается ненужным), браузер
  отказывается отдать картинку `<img>` — снова broken image, снова
  тишина в Console.
- Лечение: `crossOrigin` на same-origin `<img>` НЕ НУЖЕН вообще. Куки
  отправляются автоматически при same-origin image-loads. Просто убрать
  атрибут. Альтернатива (хуже) — добавлять lk-домен в `ALLOWED_ORIGINS`,
  чтобы middleware начал отвечать CORS-заголовками на собственный
  домен; это лишний шум без выигрыша.
- `crossOrigin` нужен только когда:
  - URL картинки на ДРУГОМ origin'е (CDN, чужой домен) И
  - вам нужно работать с пикселями через `<canvas>.getContext('2d')`
    (иначе canvas помечается tainted и `getImageData` бросает
    SecurityError). Для обычного отображения капчи это не наш случай.

## Реальный client IP теряется на upstream-Caddy после переезда

- Симптом: в access-логах SHM-api по запросам, идущим через наш
  backend-прокси (`/api/shm/*` и server-to-server `python-httpx`),
  `forwarded_for` показывает внутренний docker-IP (напр. `172.20.0.1`),
  а не реальный IP клиента. По прямым браузер→SHM запросам IP на месте.
  «Раньше работало, после переезда нет.»
- Это НЕ баг нашего кода. Цепочка `браузер → frontend-nginx → backend →
  Caddy(SHM) → SHM-api`:
  - `frontend/nginx.conf` шлёт backend'у `X-Forwarded-For` через
    `$proxy_add_x_forwarded_for` (реальный IP сохранён).
  - `ProxyHeadersMiddleware(trusted_hosts="*")` переписывает
    `scope["client"]` → реальный IP (виден в backend access-логах как
    `client`).
  - `routers/shm_proxy.py:67-75` форвардит входящий `X-Forwarded-For`
    как есть (его нет в `_DROP_REQ_HEADERS`) И перезаписывает реальным
    IP из `client_ip_ctx`. Наш backend ГАРАНТИРОВАННО отправляет
    `X-Forwarded-For: <real_ip>`.
  - **Точка потери — Caddy на стороне SHM.** Конкретно — строка
    `header_up X-Forwarded-For {remote_host}` в reverse_proxy. Плейсхолдер
    `{remote_host}` в Caddy это ВСЕГДА прямой TCP-peer, поэтому строка
    БЕЗУСЛОВНО перезаписывает входящий XFF от backend на peer-IP
    (`172.20.0.1`). Default `reverse_proxy` без явного `header_up XFF`
    appendил бы peer к существующей цепочке — явная строка этот append
    выключает.
- Правильный фикс — пара изменений в Caddyfile на стороне SHM (вне репо):
  1. Глобальный блок `servers` — научить Caddy резолвить реальный IP
     клиента из XFF, когда peer попадает в private-диапазоны:
     ```caddyfile
     {
         servers {
             trusted_proxies   static private_ranges
             client_ip_headers X-Forwarded-For
         }
     }
     ```
     `private_ranges` (Caddy 2.7+) — alias для 10/8, 172.16/12,
     192.168/16; покрывает любую docker-подсеть без необходимости знать
     точный CIDR. Безопасно: внешний клиент не сможет подделать XFF,
     потому что его peer-IP — публичный, вне trusted.
  2. В блоке `admin.{$DOMAIN}` (и для консистентности — в `bill`/`lk`)
     заменить `{remote_host}` на `{client_ip}` в `header_up X-Real-IP`
     и `header_up X-Forwarded-For`. `{client_ip}` = реальный IP клиента
     если peer trusted (резолв из XFF); fallback на `{remote_host}` для
     прямых внешних хитов — без регрессии.
- Только trusted_proxies БЕЗ замены `{remote_host}` → `{client_ip}` не
  лечит: `header_up` всё равно затрёт XFF на peer. Только замена БЕЗ
  trusted_proxies тоже не лечит: `{client_ip}` для нетрастового peer
  падает в `{remote_host}`, и мы возвращаемся к docker-IP. Нужны ОБЕ
  правки.
- Regression-тест после `caddy reload`:
  1. Прямой браузер → admin.djvpn.ru: `forwarded_for` остаётся
     `"<real_ip>, ..."` (не должен стать `"<caddy_docker_ip>, ..."`).
  2. Браузер → `lk.djvpn.ru/api/shm/*` → backend → SHM: `forwarded_for`
     по запросам с `user_agent=python-httpx` впервые показывает
     `<real_ip>` вместо `172.20.0.1`.
  3. Negative smoke с внешнего хоста:
     `curl -H 'X-Forwarded-For: 1.2.3.4' https://admin.djvpn.ru/...` —
     в логах SHM-api должен быть реальный публичный IP curl'а, НЕ
     `1.2.3.4`. Это доказывает, что trusted_proxies сужен корректно.
- Критично: эта потеря IP одинакова и для публичного URL (hairpin
  SNAT'ит source в docker-IP), и для docker-internal маршрута. Аргумент
  «через docker теряются реальные адреса» неверен — реальный адрес едет
  в XFF, а не в TCP-source, и сохраняется через `trusted_proxies` +
  `{client_ip}` в ОБОИХ случаях. CORS вообще про заголовок `Origin` (мы
  его дропаем), а не про IP. Поэтому docker-internal маршрут +
  trusted_proxies одновременно чинит и hairpin-таймауты, и реальный IP.

## Find-before-create в проксях — когда применимо, а когда нет

- Find-before-create оправдан, если внешний поиск действительно
  возвращает создаваемый объект. Если внешний search-API нестабилен
  (фильтры игнорируются, кэши, особенности URL-encoding), это
  превращается в две точки отказа вместо одной — фикс хуже бага.
- Альтернатива: использовать сам create как «exists check» — если он
  идемпотентен (PUT при дубле = 200) или возвращает понятный «already
  exists». В случае SHM PUT/admin/user даёт generic 400 без user_id, что
  тоже не годится.
- Самый надёжный путь — выполнить операцию, которая для существующего
  юзера сразу даёт результат: для auth это `POST /auth.cgi`. Получили
  session — юзер есть и логин ок. 401 — пробуем create/recover.

## Telegram WebApp в браузере: cookie с `SameSite=Lax` не сохраняются

- Когда юзер открывает Telegram WebApp в десктоп-Chrome / Yandex Browser,
  `lk.djvpn.ru` грузится в iframe внутри `web.telegram.org`. Top-level
  site (`web.telegram.org`) ≠ embed (`lk.djvpn.ru`) → контекст
  кросс-сайт / третьесторонний.
- В этом контексте Chrome (с поэтапным отключением 3rd-party cookies)
  и Yandex Browser («Защита») **молча выбрасывают** Set-Cookie с
  `SameSite=Lax` — кука не сохраняется, следующий запрос летит без
  неё, бэк отдаёт 401. Симптом: юзер видит LoginPage, в консоли
  два 401 на `/api/shm/v1/user` (один от webapp-auth-фолбэка, один
  от редиректа). В нативном Telegram-клиенте всё работает, потому
  что у него собственный webview без 3rd-party-блокировки.
- Лечение: ставить session-cookie с `SameSite=None; Secure;
  Partitioned`. `Partitioned` (CHIPS) обязателен — даже c
  `SameSite=None; Secure` Chrome всё равно фильтрует 3rd-party cookies
  в строгом режиме, а Partitioned привязывает cookie к top-level
  site и явно проходит фильтр.
- `SameSite=None` требует `Secure` (RFC 6265bis). Под HTTPS — окей,
  под HTTP (локалка/CI) откатываемся на `SameSite=Lax`: в локалке
  WebApp не воспроизводится, а same-site Lax работает как обычно.
- Starlette `response.set_cookie(partitioned=...)` появился только
  в 0.42 — в FastAPI≥0.111 транзитивно может быть и 0.37+, поэтому
  безопаснее собирать `Set-Cookie` руками через
  `response.headers.append("set-cookie", "...")`.
- JS-фолбэк через `document.cookie` (используется как страховка от
  «приватного фильтра» YaBrowser, который иногда дропает HttpOnly
  Set-Cookie на больших query-string'ах) **должен совпадать по
  атрибутам** с server-side кукой. Иначе Chrome будет хранить две
  разные cookie с одним именем и слать какую попало.
- Диагностика, что это именно cookie-проблема в iframe, а не падение
  auth-эндпоинта: бэк-лог `shm_proxy.cookies path=v1/telegram/webapp/auth
  body_session_id_present=true` (значит сессию выдали и Set-Cookie
  отправили), но следующий `shm_proxy.cookies path=v1/user
  incoming_sid=None` (cookie не пришла обратно). Если хеши `outgoing_sid`
  предыдущего auth и `incoming_sid` следующего /user не совпадают —
  то же самое, браузер не сохранил.

## Telegram Login Widget внутри Telegram WebApp — CSP `frame-ancestors`

- В консоли WebApp в браузере всплывают повторяющиеся ошибки
  `Framing 'https://oauth.telegram.org/' violates ... frame-ancestors`.
  Источник: на `/login` мы инжектим `telegram-widget.js`, который
  пытается смонтировать iframe `https://oauth.telegram.org/embed/<bot>`.
  У самого `oauth.telegram.org` CSP `frame-ancestors` не допускает
  цепочку `[lk.djvpn.ru, web.telegram.org]` — Telegram умышленно
  не разрешает встраивать свой OAuth-виджет внутри своего же WebApp.
- Виджет в WebApp-контексте бесполезен: юзер уже авторизуется по
  `initData` через наш бэк. Скрываем виджет (и блок «или») по
  условию `Boolean(window.Telegram?.WebApp?.initData)`, виджет
  остаётся только на прямом заходе на lk.djvpn.ru через браузер.
- Важно: ранний return из `useEffect`, который грузит
  `telegram-widget.js`, иначе скрипт всё равно подгружается и CSP-
  ошибки никуда не уходят — лишь рендер iframe пропускается.

## Лимиты устройств: `??` не ловит 0

- Remnawave отдаёт `hwidDeviceLimit = 0`, когда HWID-лимит отключён, а реальный
  лимит лежит в `limitIp`. Выражение `hwid ?? limit_ip ?? 5` коротит на `0`
  (оператор `??` пропускает только null/undefined), из-за чего лимит устройств
  показывался как 0/1 вместо 5.
- Урок: для числовых полей, где `0` означает «не задано», нельзя полагаться на
  `??` — нужен явный отбор положительного значения. Вынесено в
  `frontend/src/utils/deviceLimit.ts::resolveDeviceLimit` и переиспользуется во
  всех местах (DashboardPage, CompactSubscriptionCard, PlanCard, ServicesPage).

## Дубли платежей: фронт чинит только свой вектор, корень — в закрытом SHM

- Инцидент 23.06.2026: 5 реальных charge в ЮKassa за ~12 сек по одному
  `user_id`/`ts`/`amount`. Причина — SHM `pay_systems/{ps}.cgi?action=payment`
  медленный (3.5–4 c) и НЕ идемпотентный; вебвью по таймауту ретраил GET, каждый
  ретрай — новый charge.
- Ключевой факт архитектуры: `action=payment` идёт НАПРЯМУЮ на закрытый SHM
  (`bill.djvpn.ru`), мимо всего кода ЛК — фронт лишь `window.open(...action=create)`
  (`PaymentsPage.tsx`, `services.ts::buildPaymentUrl`). Поэтому ни backend-прокси
  (`shm_proxy.py`), ни фронт НЕ видят ретраи `action=payment` и перехватить их не
  могут. Радикальный фикс (идемпотентность/дедуп-шлюз перед CGI) — только на
  стороне SHM или в дедуп-прокси перед ним.
- Что закрыли на фронте (`hooks/usePaymentGuard.ts`): вектор, который фронт реально
  контролирует — пользователь повторно жмёт «Оплатить» и открывает несколько
  параллельных сессий (новый `ts` → отдельные платежи). Гард: одна именованная
  вкладка, повторный клик той же платёжки → refocus с тем же `url`/`ts` (без нового
  charge), клик по другой → блок на время кулдауна. Чистую логику вынесли в
  `decidePaymentAction` для unit-теста без DOM.
- Урок на будущее: прежде чем планировать дедуп «в прокси», убедись, что спорный
  запрос вообще проходит через прокси. Здесь сабагент предложил дедуп в
  `shm_proxy.py` — но платёж туда не заходит, решение было бы инертным.

## SHM email-верификация: поле `code` без `email`, статус в msg

- Роуты `POST /user/email` и `POST /user/email/verify` ведут в ОДИН метод
  `verify_email` (`danuk/shm`, `app/lib/Core/User.pm`), который ветвится по телу:
  - пришёл **`email`** → (пере)шлёт 6-значный код (TTL 10 мин),
    `msg: 'Verification code sent'`. Ветка всегда `return` — до проверки кода не
    доходит.
  - пришёл **`code`** (и `email` отсутствует) → сверяет: успех
    `msg: 'Email verified successfully'` (+ставит `email_verified=1`), иначе
    `'Invalid code'` / `'Code expired'`.
  - ничего → `'Email or code required'`.
- **Грабли-1**: при верификации слать ТОЛЬКО `{code}` без `email` — иначе метод
  уходит в email-ветку и просто перевыпускает код, а не проверяет его.
- **Грабли-2**: поле называется `code`, НЕ `token` (в отличие от password-reset,
  где `token`). Старый фронт слал `{token}` → SHM видел пустое тело →
  `'Email or code required'`, но код слепо рапортовал `verified:true`. Симптом:
  UI «подтверждён», а в биллинге email не подтверждён.
- **Грабли-3**: как и в password-reset, SHM отвечает **200 на любой исход** —
  статус только в `data[0].msg`. Нельзя судить по HTTP-коду; успех = точное
  совпадение msg. Хелпер `extractEmailMsg` в `api/user.ts` разбирает конверт.
- Resend кода (`requestEmailVerification`) обязан слать `{email}`, пустое тело
  код не отправляет. Регресс-тест: `frontend/src/test/emailVerify.test.ts`.

## Штатные SHM-шаблоны — референс фич, которых нет в ЛК

- Симптом: в ЛК нельзя отвязать сохранённую карту, хотя в Telegram
  WebApp-шаблоне SHM (`shm_payment.html`) кнопка `X` есть. Причина — при
  переносе списка платёжек на React портировали только «нарисовать кнопку
  оплаты», а ветку `if (pay_system.allow_deletion)` потеряли.
- `/user/pay/paysystems` отдаёт у сохранённых способов оплаты флаг
  `allow_deletion: 1` (плюс `recurring`/`internal`). Отвязка —
  `DELETE /shm/v1/user/autopayment?pay_system=<paysystem>` (код платёжной
  системы, НЕ `name`), параметр идёт в query, тела нет.
- Урок: если фича SHM «была в старом WebApp», сверяйся с его шаблоном как со
  спекой API — там видно и точный эндпоинт, и имя поля. Заодно проверь, что
  флаг вообще доехал до TS-типа: `PaySystemV2` молча ронял `allow_deletion`,
  и UI не мог его увидеть, даже если бы кнопку нарисовали.
- Прокси `/api/shm/*` уже пропускает `DELETE` и форвардит `request.query_params`
  (`routers/shm_proxy.py`) — для таких фич бэк трогать не нужно.

## SHM регистрация НЕ сохраняет email — нужен явный set_email

- Корень бага «при регистрации почта не подтверждается» (профиль при этом
  работал): `PUT /user` ведёт в `reg_api_safe` (`app/lib/Core/User.pm`),
  который принимает ТОЛЬКО `login`/`password`/`partner_id`/`captcha_*` и
  **молча игнорирует `email`**. Поле `email` в теле `PUT /user` никуда не
  сохраняется.
- Поэтому email надо привязывать отдельным вызовом `PUT /user/email`
  (`set_email`): он кладёт `email` и `email_verified=0` в settings и ставит
  `login2=email`. Только после этого `POST /user/email` (send-ветка
  `verify_email`) находит `current_email`, совпадает и шлёт код; иначе —
  `'Email mismatch. Use the email shown in your profile.'` (HTTP 200) и код
  НЕ уходит.
- Профиль работал именно потому, что `updateEmail` делает правильную
  последовательность `PUT /user/email` → `POST /user/email`. Регистрация же
  слала только `POST /user/email` после `PUT /user` — и падала в mismatch.
- Фикс: в `registerWithPassword` (`api/auth.ts`) перед отправкой кода звать
  `PUT /user/email {email}`, как в профиле. `email_verification_sent` ставить
  только на msg `'Verification code sent'`, а не слепо true.
- Регресс-тест: `frontend/src/test/authRegister.test.ts` (порядок PUT→POST).
