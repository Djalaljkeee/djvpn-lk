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

## SHM API: undocumented поля

- В Swagger описаны не все поля, которые принимает SHM. Например, `partner_id`
  отсутствует в схеме `User`, но и публичный `PUT /shm/v1/user`, и
  admin `PUT /shm/v1/admin/user` его принимают (этим пользуется Telegram-бот
  через `/start <id>`).
- При интеграции с SHM сверяйтесь с реальным поведением (логи бота / dev-инстанс),
  а не только со Swagger.

## Реферальные ссылки в SPA

- Захватывать `?ref=ID` нужно **до** маршрутизации/редиректов: лучше прямо
  в `App.tsx` при первом рендере, иначе Telegram OAuth-редирект на /login
  «съест» query-параметр.
- Хранить в `localStorage` (не в state/zustand) — переживает все навигации
  и обновление страницы. После успешной регистрации/авторизации обязательно
  чистить, иначе ref «прилипнет» к устройству для всех будущих регистраций.
- На бэке писать `partner_id` ТОЛЬКО при создании пользователя. Для уже
  существующих юзеров проброс игнорируется (так делает Telegram-бот:
  `/start <id>` имеет смысл только при первом контакте).

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
- Лечение: `frontend/src/utils/normalizers.ts` дублирует логику
  `normalize_user_service` / `normalize_catalog_service` /
  `normalize_payment` / `normalize_user`. Применяется в API-функциях
  один раз — компоненты остаются на «нашей» форме.
- Правило: если backend нормализовал поля до миграции, при перехо́де на
  прямой вызов **сразу** портируй нормализатор на TS, а не «потом
  починим UI». UI потом не починят.

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

## `<img crossOrigin="use-credentials">` ломает same-origin картинку

- Симптом: `GET /api/shm/v1/user/captcha` отдаёт `200 OK` с правильным
  PNG в теле, в DevTools запрос зелёный, но `<img>` рендерит
  broken-image placeholder. «Доходит, но не показывает.»
- Причина: атрибут `crossOrigin="use-credentials"` на `<img>` ВСЕГДА
  переводит загрузку картинки в CORS-режим — даже когда URL same-origin
  (`lk.djvpn.ru → /api/...`). Браузер шлёт `Origin: https://lk.djvpn.ru`
  и требует в ответе `Access-Control-Allow-Origin: <origin>` +
  `Access-Control-Allow-Credentials: true`.
- Дальше дело в `CORSMiddleware` нашего FastAPI (main.py): он смотрит
  Origin против `ALLOWED_ORIGINS` (по умолчанию `["https://bill.djvpn.ru"]`)
  и для same-origin `lk.djvpn.ru` НЕ добавляет ACA-O — потому что
  считается, что same-origin CORS не нужен. Браузер видит 200 без
  ACA-O → отказывается отдать картинку JS/`<img>` → broken image.
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
