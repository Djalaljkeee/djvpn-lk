# Передача ID агента (partner_id) по реферальной ссылке + регистрация через Telegram-виджет

## Контекст

Задача: проверить, доезжает ли `partner_id` (ID агента) при переходе по
реферальной ссылке ЛК и нет ли ошибок при регистрации через Telegram Login
Widget.

Разбор вёлся по исходникам SHM (`danuk/shm`, ветка master), потому что весь
auth/registration-флоу ЛК ходит напрямую в SHM через прокси `/api/shm/*`.
Ключевой факт роутера SHM (`app/public_html/shm/v1.cgi`):

```perl
my %args = (
    %{ $p->{args} || {} },   # значения по умолчанию из описания роута
    %in,                     # ВСЁ, что прислал клиент (query + JSON-body)
    admin => $admin_mode,
);
```

то есть `args` в описании роута — это **дефолты, а не whitelist**: любое поле
из тела запроса доезжает до контроллера. Значит `partner_id` технически
проходит; ломалось другое.

## Найденные дефекты

### 1. Регистрация через Telegram-виджет невозможна (блокер)

`Core::Transport::Telegram::web_auth` создаёт пользователя только под флагом:

```perl
if ( !$user && $args{register_if_not_exists} ) {
    $user = $self->user->reg( ..., $args{partner_id} ? (partner_id => $args{partner_id}) : () );
}
if ( !$args{register_if_not_exists} && !$user ) {
    logger->error("Telegram WebApp auth error: user not found");
    $self->set_user_fail_attempt( 'web_auth', 3600, $self->telegram_ips );
    return undef;
}
```

В описании роута `/telegram/web/auth` дефолт — `register_if_not_exists => 0`,
а фронт этот флаг не слал. Итог для НОВОГО пользователя:

- SHM возвращает `HTTP 200` с телом `{"data":[null],"status":200}` —
  `report->error` не вызывается, поэтому 4xx не приходит;
- сессии в теле нет → прокси не выставляет `session_id`;
- следующий `GET /user` ловит 401 → интерцептор `handle401` разлогинивает,
  пользователь видит generic «Ошибка авторизации через Telegram»;
- каждая попытка инкрементит `set_user_fail_attempt('web_auth', 3600)` —
  на 5-й попытке SHM отдаёт `429` на час.

`partner_id` при этом не имел ни единого шанса примениться: он используется
только внутри той ветки `reg()`, до которой поток не доходил.

### 2. Капча при регистрации: неверные имена полей

`Core::User::reg_api_safe` проверяет капчу так:

```perl
$self->verify_captcha( token => $args{captcha_token}, answer => $args{captcha_answer} );
```

а `verify_captcha` возвращает `0`, если **любое** из двух полей не определено.
Фронт слал `captcha` и `captcha_code`, а подписанный `token` из ответа
`GET /user/captcha` (`data[0].token`) вообще выбрасывал — `fetchCaptcha`
читал только `image`. Следствия:

- при `billing.allow_user_register_captcha = 1` регистрация по email
  (в т.ч. по реферальной ссылке) падает с 403 `Invalid captcha` — всегда;
- при выключённом флаге поле капчи в UI — бутафория.

Капча в SHM stateless: `token` = `base64url(answer_hash|timestamp|sig)`,
TTL 5 минут; cookie-сессия к ней отношения не имеет (комментарий в старом
коде утверждал обратное).

### 3. Telegram-deeplink `?start=<user_id>` не передаёт pid

SHM разбирает аргумент `/start` как **base64url-строку вида `k=v&k=v`**:

```perl
for my $pair ( split /&/, decode_base64url( $args[0] ) ) {
    my ( $key, $value ) = split ( /=/, $pair );
    $start_args{ $key } = uri_unescape( $value ) if defined $key && defined $value;
}
...
$args{partner_id} //= $start_args{pid};   # sub shmRegister
```

Голый `?start=2` декодируется в мусор, пары `key=value` нет, `pid` не
находится — реферал теряется молча. Формат base64url в SHM с 22.01.2025,
так что запись `/start <id>` из `tasks/lessons.md` устарела.

### 4. `captureRefIdFromUrl()` перезаписывает ref после `clearRefId()`

`App.tsx` вызывает `captureRefIdFromUrl()` в теле рендера, а URL намеренно не
чистится. После успешной авторизации `clearRefId()` удаляет ключ, но любой
следующий рендер (а `?ref=` всё ещё в адресной строке) кладёт его обратно —
ref «прилипает» к устройству, ровно то, что запрещено в `lessons.md`.

### 5. `ShortRefRedirect` сохранял ref в `useEffect`

Эффекты дочернего `<Navigate>` выполняются раньше эффектов родителя, то есть
редирект стартует до записи `partner_id`. Сейчас спасает только то, что React
успевает дофлашить passive effects до следующего рендера — гонка на ровном месте.

### 6. Сообщения об ошибках SHM не показывались

Прокси отдаёт тело SHM как есть, а SHM кладёт текст в `error`
(`{"status":400,"error":"..."}`), не в `detail`. `LoginPage` читал только
`e?.response?.data?.detail` → пользователь всегда видел generic-текст.

### Не дефекты (проверено, оставлено как есть)

- `partner_id` в `loginWithWebApp` (Mini App): `webapp_auth` пользователей не
  регистрирует вовсе (`user not found` → undef), параметр игнорируется. Внутри
  Mini App юзер создаётся ботом по `/start`, поэтому pid приходит через deeplink.
  Вреда нет, оставлен с комментарием.
- `partner_id` в `PUT /user`: `reg_api_safe` → `reg()` принимает и валидирует
  (`$self->id($partner_id)`, запрет self-referral) — работает.
- `backend/models.py::RegisterRequest/TelegramAuthRequest` — легаси-модели
  времён backend-агрегатора, ни одним роутером не используются.

## Задачи

- [x] `api/auth.ts::loginWithTelegram` — `register_if_not_exists: 1` + partner_id.
- [x] `api/auth.ts` — `captureSessionFromBody` возвращает session_id;
      `requireSession` бросает понятную ошибку на «200 без сессии» для обоих
      Telegram-эндпоинтов.
- [x] `api/auth.ts::fetchCaptcha` — отдаёт `token` из `data[0].token`.
- [x] `api/auth.ts::registerWithPassword` — шлёт `captcha_token`/`captcha_answer`.
- [x] `pages/LoginPage.tsx` — прокидывает `captcha_token`; извлечение текста
      ошибки из `error`/`detail`/`message`.
- [x] `pages/ReferralsPage.tsx` — deeplink `?start=<base64url("pid=<id>")>`.
- [x] `utils/referral.ts` — захват из URL ровно один раз за загрузку страницы.
- [x] `App.tsx::ShortRefRedirect` — запись ref до рендера `<Navigate>`.
- [x] `frontend/src/test/referral.test.ts` — регресс-тесты на всё перечисленное.
- [x] `tasks/lessons.md` — уроки по `register_if_not_exists`, капче и deeplink.

## Ревью

Все правки — на фронте: backend-прокси уже прозрачно форвардит и тело, и
query, и `Set-Cookie`, трогать его не потребовалось.

Проверка: `npm test` — 10 файлов, 58 тестов, все зелёные (из них 15 новых в
`referralCapture.test.ts`); `npx tsc --noEmit` чистый; `npm run build` собирается.

Что осталось на стороне SHM/инфраструктуры (вне репозитория):

- `set_user_fail_attempt` считает попытки по IP. Пока Caddy на стороне SHM не
  резолвит реальный IP из `X-Forwarded-For` (см. урок «Реальный client IP
  теряется на upstream-Caddy»), все пользователи ЛК для SHM — один IP, и
  5 неудачных попыток входа через виджет от кого угодно вешают 429 на час
  на всех сразу. Фикс #1 убирает основной источник этих неудач, но правку
  Caddyfile всё равно надо довести.
- Уровни/комиссии реферальной программы (`LEVELS` в `ReferralsPage`) живут на
  фронте — переносить в SHM-шаблон, когда заказчик заведёт поля.
