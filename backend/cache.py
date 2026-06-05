"""Lightweight cache с опциональным Redis-бэкендом.

Если `REDIS_URL` задан — используется Redis (asyncio).
Если пуст — in-memory fallback (без межпроцессной синхронизации, но
корректно работает при одном воркере uvicorn).

API намеренно минималистичен:
  - `await cache.get(key)`
  - `await cache.set(key, value, ttl=60)`
  - `await cache.get_or_set(key, ttl, factory)`  — кешируем JSON-совместимые dict/list
  - `await cache.delete(*keys)`

Вызывающий код обязан приводить значения к JSON-сериализуемому виду.
"""

from __future__ import annotations

import json
import time
from typing import Any, Awaitable, Callable, Optional

from config import settings
from logging_config import get_logger


log = get_logger("cache")


class _MemoryCache:
    """Простой in-memory LRU без вытеснения — достаточно при одном воркере."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}

    async def get(self, key: str) -> Optional[Any]:
        entry = self._store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at and expires_at < time.time():
            self._store.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: Any, ttl: int = 60) -> None:
        expires_at = time.time() + ttl if ttl > 0 else 0
        self._store[key] = (expires_at, value)

    async def delete(self, *keys: str) -> None:
        for k in keys:
            self._store.pop(k, None)


class _RedisCache:
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis_async  # локальный импорт — redis опционален

        # Без явных timeout'ов redis-py может ждать ответа БЕСКОНЕЧНО. Если
        # Redis потеряет ответ (network blip, OOM, swap), ВСЕ корутины cache.*
        # повиснут навсегда — а вместе с ними event loop FastAPI. С таймаутами
        # вместо немого зависания мы получаем явный TimeoutError, который
        # вызывающий код уже умеет ловить.
        self._client = redis_async.from_url(
            url,
            decode_responses=True,
            socket_timeout=5.0,
            socket_connect_timeout=3.0,
            health_check_interval=30,
        )

    async def get(self, key: str) -> Optional[Any]:
        raw = await self._client.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    async def set(self, key: str, value: Any, ttl: int = 60) -> None:
        data = json.dumps(value, default=str)
        if ttl > 0:
            await self._client.set(key, data, ex=ttl)
        else:
            await self._client.set(key, data)

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._client.delete(*keys)


class Cache:
    """Обёртка, которую использует приложение. Выбирает backend."""

    def __init__(self) -> None:
        self._backend: Any = _MemoryCache()
        self._configured = False

    def configure(self) -> None:
        if self._configured:
            return
        self._configured = True
        if not settings.REDIS_URL:
            log.info("cache.memory_backend", reason="REDIS_URL empty")
            return
        try:
            self._backend = _RedisCache(settings.REDIS_URL)
            log.info("cache.redis_backend", url=_safe_url(settings.REDIS_URL))
        except Exception as exc:  # pragma: no cover
            log.warning("cache.redis_init_failed", error=str(exc))

    async def get(self, key: str) -> Optional[Any]:
        return await self._backend.get(key)

    async def set(self, key: str, value: Any, ttl: int = 60) -> None:
        await self._backend.set(key, value, ttl=ttl)

    async def delete(self, *keys: str) -> None:
        await self._backend.delete(*keys)

    async def get_or_set(
        self,
        key: str,
        ttl: int,
        factory: Callable[[], Awaitable[Any]],
    ) -> Any:
        cached = await self.get(key)
        if cached is not None:
            return cached
        fresh = await factory()
        try:
            await self.set(key, fresh, ttl=ttl)
        except Exception as exc:  # pragma: no cover
            log.warning("cache.set_failed", key=key, error=str(exc))
        return fresh


def _safe_url(url: str) -> str:
    """Скрываем пароль в лог-сообщениях."""
    if "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    return f"{scheme}://***@{host}"


cache = Cache()


async def invalidate_dashboard(user_id: Any) -> None:
    """Сбросить агрегированный кеш `/api/dashboard` для пользователя.

    Вызывается из мутирующих хендлеров (оплаты, покупка/смена/удаление услуг,
    удаление устройств, применение промокода). No-op при пустом user_id —
    неавторизованные мутации не ожидаются, но вести себя безопасно дешевле.
    """
    if not user_id:
        return
    try:
        await cache.delete(f"dashboard:{user_id}")
    except Exception as exc:  # pragma: no cover — кеш не должен рушить мутацию
        log.warning("cache.invalidate_dashboard_failed", user_id=user_id, error=str(exc))
