# Отвязка сохранённой платёжной карты в ЛК

## Контекст

В списке «Пополнение баланса» SHM отдаёт сохранённые способы оплаты
(`Bank card *5777`) наравне с обычными платёжками, но в ЛК не было кнопки
удаления — привязанную карту нельзя было отвязать. Штатный Telegram
WebApp-шаблон SHM это умеет: рисует кнопку `X` для платёжек с
`allow_deletion` и шлёт `DELETE /shm/v1/user/autopayment?pay_system=<id>`.
В ЛК поле `allow_deletion` даже не было в TS-типе `PaySystemV2`, поэтому
признак терялся ещё на уровне API-слоя.

## Задачи

- [x] `frontend/src/api/services.ts` — добавить `allow_deletion` в
      `PaySystemV2` и функцию `deleteAutopayment(pay_system)`
      (`DELETE /user/autopayment?pay_system=…`).
- [x] `frontend/src/pages/PaymentsPage.tsx` — кнопка отвязки (иконка корзины)
      рядом со способом оплаты с `allow_deletion`, модалка подтверждения
      (портал в `body`, как в `ServicesPage`), спиннер на время запроса,
      `invalidate()` дашборда + тост после успеха.
- [x] Тесты: `src/test/autopayment.test.ts` (контракт запроса к SHM),
      `src/test/paymentsDelete.test.tsx` (UI-флоу: кнопка только у
      `allow_deletion`, подтверждение → DELETE → refresh, ошибка → модалка
      остаётся).

## Ревью

- `npm test` — 43/43 зелёные (9 файлов), `npm run build` (tsc + vite) — зелёная.
- Прокси `/api/shm/*` уже разрешает `DELETE` и форвардит query-параметры
  (`backend/routers/shm_proxy.py:62,98`) — правок на бэке не потребовалось.
- Способы оплаты без `allow_deletion` рендерятся ровно как раньше (кнопки нет),
  логика `usePaymentGuard` не тронута.
- При ошибке SHM модалка не закрывается и дашборд не инвалидируется — юзер
  видит тост об ошибке, а не «молчаливый успех».
