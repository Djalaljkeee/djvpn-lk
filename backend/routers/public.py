"""Public endpoints (no auth)."""

from fastapi import APIRouter

from config import settings
from models import PublicConfig


router = APIRouter()


@router.get("/api/config", response_model=PublicConfig)
async def get_public_config():
    """Публичная конфигурация для фронтенда."""
    return PublicConfig(telegram_bot_username=settings.TELEGRAM_BOT_USERNAME)
