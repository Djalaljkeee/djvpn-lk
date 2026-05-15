# Уроки

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
