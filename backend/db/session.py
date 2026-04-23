"""Async SQLAlchemy engine + FastAPI dependency.

Если `DATABASE_URL` пуст — движок не создаётся и функции либо работают
no-op (`db_enabled()` возвращает False), либо бросают 503, чтобы на
клиенте было явное указание о неготовности БД.
"""

from __future__ import annotations

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


async def run_migrations() -> None:
    """Применяет alembic upgrade head.

    Выполняется offline через программный API alembic, чтобы не тащить
    shell-entrypoint и не зависеть от раскладки CWD в контейнере.
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

    cfg = Config(alembic_ini)
    cfg.set_main_option("script_location", os.path.join(here, "alembic"))
    cfg.set_main_option("sqlalchemy.url", _normalize_url(settings.DATABASE_URL))

    log.info("db.migrations_start")
    try:
        command.upgrade(cfg, "head")
        log.info("db.migrations_done")
    except Exception as exc:
        log.error("db.migrations_failed", error=str(exc))
        raise


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
