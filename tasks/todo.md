# Белый экран из-за блокировки Telegram в РФ

## Контекст

У части пользователей в РФ `telegram.org` режется DPI. Пока запрос к нему не
уходил в сетевой таймаут, страница ЛК висела белым экраном.

**Корневая причина** — `frontend/index.html`: WebApp SDK
`telegram-web-app.js` подключался **блокирующим** синхронным тегом в `<head>`
(без `async`/`defer`). Парсер HTML останавливался на нём и не доходил до
`<script type="module" src="/src/main.tsx">` в `<body>` → React-бандл не
исполнялся, `#root` пустой → белый экран до сетевого таймаута.

## Задачи

- [x] `frontend/index.html` — добавить `async` к `telegram-web-app.js`
      (снятие блокировки first paint / bootstrap React).
- [x] `frontend/src/App.tsx` (`TelegramWebAppGate`) — т.к. SDK теперь грузится
      async, детектить Mini App по launch-параметрам (`#tgWebAppData`,
      `TelegramWebviewProxy`) без зависимости от SDK и ждать `initData` до
      таймаута (3с). Обычные браузерные пользователи не ждут SDK; авто-логин
      Mini App сохранён.
- [x] `frontend/src/pages/LoginPage.tsx` — таймаут/фолбэк Login-виджета: если
      iframe не отрисовался за 5с (или `onerror`), показать подсказку
      «войдите по логину/паролю» вместо пустой коробки.

## Ревью

- Сборка `npm run build` (tsc + vite) — зелёная. Тесты `npm test` — 26/26.
- Рантайм-проверка (Playwright + предустановленный Chromium, telegram.org
  «висит»):
  - До фикса (блокирующий скрипт): **белый экран >15с (таймаут)**.
  - После фикса (`async`): рендер **~130мс** даже при заблокированном
    telegram.org.
- Корневая причина устранена; авто-логин Mini App и обычный вход не затронуты.
