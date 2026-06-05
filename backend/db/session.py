"""Async SQLAlchemy engine + FastAPI dependency.

Если `DATABASE_URL` пуст — движок не создаётся и функции либо работают
no-op (`db_enabled()` возвращает False), либо бросают 503, чтобы на
клиенте было явное указание о неготовности БД.
"""

from __future__ import annotations

import asyncio
from typing import AsyncIterator, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from config import settings
from logging_config import get_logger


log = get_logger("db")


_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def _normalize_url(url: str) -> str:
    """Принимаем и `postgresql://…`, и готовый `postgresql+asyncpg://…`."""
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://"):]
    return url


def db_enabled() -> bool:
    return bool(settings.DATABASE_URL)


def init_engine() -> None:
    """Создаёт engine и sessionmaker (однократно)."""
    global _engine, _session_factory
    if not db_enabled():
        log.info("db.disabled", reason="DATABASE_URL empty")
        return
    if _engine is not None:
        return
    url = _normalize_url(settings.DATABASE_URL)
    _engine = create_async_engine(
        url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        # Явные тайминги вместо неявных дефолтов SQLAlchemy:
        # pool_timeout=10 — если пул исчерпан, лучше быстро вернуть 503,
        #   чем копить хвост запросов, ждущих коннект (по умолчанию 30с).
        # pool_recycle=1800 — переоткрываем коннекты раз в 30 минут, чтобы
        #   не натыкаться на TCP idle-таймауты со стороны Postgres/балансера.
        pool_timeout=10,
        pool_recycle=1800,
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    log.info("db.engine_initialized")


async def shutdown_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
        log.info("db.engine_disposed")


_PROBE_TIMEOUT_S = 5.0
_MIGRATION_TIMEOUT_S = 120.0


async def _wait_for_db_ready(url: str, timeout: float = _PROBE_TIMEOUT_S) -> None:
    """Проверяет, что Postgres реально принимает asyncpg-коннекшены.

    `pg_isready` в docker-healthcheck говорит только про TCP/процесс, но не
    про готовность принимать клиентский startup-пакет (recovery, scram, SSL
    handshake могут ещё не завершиться). У asyncpg по умолчанию нет
    connect-timeout — без него миграции могут зависнуть **бесконечно** без
    единой строки в логах. Эта проба ограничивает ожидание явным таймаутом
    и логирует точку сбоя.
    """
    import asyncpg

    pure = url
    if pure.startswith("postgresql+asyncpg://"):
        pure = "postgresql://" + pure[len("postgresql+asyncpg://"):]
    log.info("db.probe_start", timeout_s=timeout)
    conn = await asyncio.wait_for(asyncpg.connect(pure), timeout=timeout)
    try:
        await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=timeout)
    finally:
        await conn.close()
    log.info("db.probe_ok")


async def run_migrations() -> None:
    """Применяет alembic upgrade head.

    Alembic env.py вызывает `asyncio.run()` — это нельзя делать из уже
    запущенного event loop (FastAPI lifespan). Поэтому синхронный
    `command.upgrade(...)` выполняем в отдельном потоке через
    `asyncio.to_thread`: там loop не запущен, и alembic спокойно
    стартует свой собственный.

    Перед каждой попыткой делаем lightweight asyncpg-пробу с явным
    таймаутом — без неё зависание на handshake не видно в логах.
    Сам upgrade ограничен `_MIGRATION_TIMEOUT_S`: даже если внутри
    Alembic что-то встанет (lock, бесконечный DDL), мы упадём, залогируем
    и попробуем ещё раз вместо тихого простоя.

    5 попыток с экспоненциальным бэкоффом — postgres может ответить
    healthy раньше, чем реально готов принимать asyncpg.
    """
    if not db_enabled():
        return

    import os
    from alembic import command
    from alembic.config import Config

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_ini = os.path.join(here, "alembic.ini")
    if not os.path.exists(alembic_ini):
        log.warning("db.alembic_ini_missing", path=alembic_ini)
        return

    url = _normalize_url(settings.DATABASE_URL)
    cfg = Config(alembic_ini)
    cfg.set_main_option("script_location", os.path.join(here, "alembic"))
    cfg.set_main_option("sqlalchemy.url", url)

    max_attempts = 5
    backoff = 1.0
    last_exc: Exception | None = None

    for attempt in range(1, max_attempts + 1):
        log.info("db.migrations_start", attempt=attempt, max_attempts=max_attempts)
        try:
            await _wait_for_db_ready(url)
            log.info("db.migrations_applying", timeout_s=_MIGRATION_TIMEOUT_S)
            await asyncio.wait_for(
                asyncio.to_thread(command.upgrade, cfg, "head"),
                timeout=_MIGRATION_TIMEOUT_S,
            )
            log.info("db.migrations_done")
            return
        except Exception as exc:
            last_exc = exc
            if attempt == max_attempts:
                log.error(
                    "db.migrations_failed",
                    error=str(exc),
                    error_type=type(exc).__name__,
                    attempt=attempt,
                )
                raise
            log.warning(
                "db.migrations_attempt_failed",
                error=str(exc),
                error_type=type(exc).__name__,
                attempt=attempt,
                retry_in_s=backoff,
            )
            await asyncio.sleep(backoff)
            backoff *= 2

    # unreachable, but keeps static analysers happy
    if last_exc is not None:
        raise last_exc


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: выдаёт сессию БД на время запроса."""
    if _session_factory is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    async with _session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        else:
            await session.commit()
