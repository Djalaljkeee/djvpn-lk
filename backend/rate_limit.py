"""slowapi Limiter с поддержкой Redis и in-memory fallback.

Ограничители применяются точечно в роутерах: декоратор `@limiter.limit("10/minute")`
над чувствительными эндпоинтами (логин/регистрация/капча/промо).
"""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings
from logging_config import get_logger


log = get_logger("ratelimit")


def _storage_uri() -> str:
    if settings.REDIS_URL:
        return settings.REDIS_URL
    return "memory://"


def _key_func(request: Request) -> str:
    # Если пользователь аутентифицирован — лимитируем и по user_id,
    # иначе по IP. Это не позволяет одному IP обойти лимиты через несколько
    # JWT, но не наказывает легитимных пользователей за NAT.
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return f"user:{auth[-16:]}"
    return get_remote_address(request)


limiter = Limiter(
    key_func=_key_func,
    enabled=settings.RATE_LIMIT_ENABLED,
    storage_uri=_storage_uri(),
    default_limits=[settings.RATE_LIMIT_DEFAULT] if settings.RATE_LIMIT_DEFAULT else [],
)


log.info(
    "ratelimit.configured",
    enabled=settings.RATE_LIMIT_ENABLED,
    storage=_storage_uri().split("://", 1)[0],
    default=settings.RATE_LIMIT_DEFAULT,
)
