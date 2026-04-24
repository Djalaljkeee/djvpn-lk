from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # SHM
    SHM_BASE_URL: str = "http://your-shm-host:3001"
    SHM_PUBLIC_URL: str = ""   # публичный URL SHM для ссылок оплаты (напр. https://bill.djvpn.ru)
    SHM_ADMIN_URL: str = ""    # URL admin-панели SHM (напр. https://admin.djvpn.ru) — для Telegram auth
    SHM_ADMIN_LOGIN: str = "admin"
    SHM_ADMIN_PASSWORD: str = "admin"

    # JWT
    JWT_SECRET: str = "change-me-in-production-32-chars-min"
    JWT_EXPIRE_SECONDS: int = 86400 * 30  # 30 дней

    # Telegram
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""  # без @

    # Remnawave HWID
    REMNA_BASE_URL: str = ""   # https://vpn.example.com
    REMNA_TOKEN: str = ""      # Bearer-токен Remnawave

    # Uptime Kuma status page (e.g. https://kuma.djvpn.ru/status/djvpn)
    KUMA_STATUS_URL: str = ""

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Database (пусто = БД выключена, бэкенд работает как stateless-прокси)
    DATABASE_URL: str = ""
    # True — падение миграций/коннекта считается фатальным (crashloop),
    # False — бэкенд стартует даже если БД недоступна: cart/notifications
    # вернут 503, остальные маршруты работают как обычно.
    DB_REQUIRED: bool = True

    # Redis (пусто = in-memory cache + in-memory rate-limit)
    REDIS_URL: str = ""

    # Rate limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = ""   # напр. "200/minute" — общий лимит на любые эндпоинты

    # Scheduler (фоновые задачи)
    SCHEDULER_ENABLED: bool = True
    # Дни хранения in-app уведомлений (0 — не чистить)
    NOTIFICATION_RETENTION_DAYS: int = 90
    # Дни, после которых корзина протухает
    CART_RETENTION_DAYS: int = 7

    # Observability
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True       # False — человекочитаемый вывод для dev
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "production"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0   # 0 = выключено; 0.05 — 5% запросов

    class Config:
        # В Docker env vars передаются через docker-compose env_file
        # При локальной разработке — через backend/.env
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # игнорировать SHM_NETWORK и другие docker-only переменные


settings = Settings()
