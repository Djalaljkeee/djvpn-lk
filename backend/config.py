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

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        # В Docker env vars передаются через docker-compose env_file
        # При локальной разработке — через backend/.env
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"  # игнорировать SHM_NETWORK и другие docker-only переменные


settings = Settings()
