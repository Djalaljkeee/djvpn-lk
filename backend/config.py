from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # SHM
    SHM_BASE_URL: str = "http://your-shm-host:3001"
    SHM_ADMIN_LOGIN: str = "admin"
    SHM_ADMIN_PASSWORD: str = "admin"

    # JWT
    JWT_SECRET: str = "change-me-in-production-32-chars-min"
    JWT_EXPIRE_SECONDS: int = 86400 * 30  # 30 дней

    # Telegram
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_BOT_USERNAME: str = ""  # без @

    # CORS
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
