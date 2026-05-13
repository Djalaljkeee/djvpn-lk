from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # SHM — внешний API. Фронт ходит напрямую (см. frontend/src/api/client.ts),
    # backend использует базу для двух вещей: верификация cookie и Marzban storage.
    SHM_BASE_URL: str = "https://admin.djvpn.ru"
    # Публичный URL платёжного шлюза SHM (для построения ссылок на оплату).
    SHM_BILL_URL: str = "https://bill.djvpn.ru"

    # Telegram (имя бота показывается на /login)
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""  # без @

    # Remnawave HWID
    REMNA_BASE_URL: str = ""   # https://vpn.example.com
    REMNA_TOKEN: str = ""      # Bearer-токен Remnawave

    # Uptime Kuma status page (e.g. https://kuma.djvpn.ru/status/djvpn)
    KUMA_STATUS_URL: str = ""

    # CORS — фронт ходит напрямую в SHM, backend остаётся для cart/notifications/
    # devices/vpn/status. allow_credentials=True обязателен — браузер
    # шлёт cookie session_id и в backend, и в SHM.
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Database (пусто = БД выключена, бэкенд работает как stateless-прокси)
    DATABASE_URL: str = ""
    DB_REQUIRED: bool = True

    # Redis (пусто = in-memory cache + in-memory rate-limit)
    REDIS_URL: str = ""

    # Rate limiting
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_DEFAULT: str = ""

    # Maintenance mode (принудительный баннер + ограничение части действий)
    MAINTENANCE_MODE: bool = False
    MAINTENANCE_MESSAGE: str = ""

    # Scheduler (фоновые задачи)
    SCHEDULER_ENABLED: bool = True
    NOTIFICATION_RETENTION_DAYS: int = 90
    CART_RETENTION_DAYS: int = 7

    # Observability
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True
    SENTRY_DSN: str = ""
    SENTRY_ENVIRONMENT: str = "production"
    SENTRY_TRACES_SAMPLE_RATE: float = 0.0

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()
