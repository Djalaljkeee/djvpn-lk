# SHM Cabinet

Личный кабинет для SHM биллинга с авторизацией через Telegram и логин/пароль.

## Стек

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS + Zustand
- **Backend**: Python FastAPI (прокси к SHM API)
- **Auth**: Telegram Login Widget + логин/пароль через SHM

## Быстрый старт

### 1. Backend

```bash
cd backend
cp .env.example .env
# Заполни .env (SHM_BASE_URL, TELEGRAM_BOT_TOKEN и др.)
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env
# Укажи VITE_TELEGRAM_BOT_USERNAME
npm install
npm run dev
```

Открой http://localhost:5173

### Через Docker Compose

```bash
# Заполни backend/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

docker compose up --build
```

Открой http://localhost

---

## Конфигурация backend (.env)

| Переменная | Описание |
|---|---|
| `SHM_BASE_URL` | URL вашего SHM (напр. `http://shm:3001`) |
| `SHM_ADMIN_LOGIN` | Логин admin в SHM |
| `SHM_ADMIN_PASSWORD` | Пароль admin в SHM |
| `JWT_SECRET` | Секрет для JWT токенов (≥32 символа) |
| `JWT_EXPIRE_SECONDS` | Время жизни токена (по умолч. 30 дней) |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather |
| `TELEGRAM_BOT_USERNAME` | Username бота без @ |
| `ALLOWED_ORIGINS` | CORS — домены фронта (JSON-массив) |

## Конфигурация frontend (.env)

| Переменная | Описание |
|---|---|
| `VITE_TELEGRAM_BOT_USERNAME` | Username бота без @ |

---

## Как работает авторизация через Telegram

1. Пользователь нажимает кнопку «Войти через Telegram»
2. Telegram Login Widget возвращает данные с подписью (hash)
3. Backend верифицирует подпись через `HMAC-SHA256(bot_token)`
4. Backend ищет пользователя в SHM по логину `@telegram_id`
5. Если не найден — регистрирует нового пользователя
6. Возвращает JWT токен с SHM `session_id` внутри

## Структура проекта

```
shm-cabinet/
├── backend/
│   ├── main.py          # FastAPI приложение
│   ├── config.py        # Конфигурация через pydantic-settings
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── api/         # Клиенты к backend API
│   │   ├── components/  # Layout, общие компоненты
│   │   ├── pages/       # Dashboard, Services, Payments, Referrals
│   │   ├── store/       # Zustand (auth)
│   │   └── types/       # TypeScript типы
│   ├── Dockerfile
│   ├── nginx.conf
│   └── .env.example
└── docker-compose.yml
```

## API эндпоинты backend

| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/login` | Вход по логину/паролю |
| POST | `/api/auth/telegram` | Вход через Telegram |
| GET | `/api/user/profile` | Профиль пользователя |
| GET | `/api/user/services` | Услуги пользователя |
| GET | `/api/user/payments` | История платежей |
| GET | `/api/user/referrals` | Рефералы и доходы |
| GET | `/api/services` | Каталог тарифов |
| POST | `/api/services/buy` | Купить услугу |
| GET | `/api/pay-systems` | Платёжные системы |
| POST | `/api/pay/create` | Создать платёж |
