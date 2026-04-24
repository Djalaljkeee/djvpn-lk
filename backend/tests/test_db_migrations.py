"""Проверяем, что run_migrations не вызывает asyncio.run внутри
текущего loop — иначе FastAPI lifespan падает с
RuntimeError: asyncio.run() cannot be called from a running event loop.

Тест имитирует ровно этот сценарий: на running event loop запускаем
run_migrations, в котором command.upgrade замокан так, чтобы изнутри
пытаться сделать asyncio.run() — аналогично тому, что делает
alembic/env.py. После фикса (asyncio.to_thread) такой код работает.
"""

from __future__ import annotations

import asyncio

import pytest


@pytest.mark.asyncio
async def test_run_migrations_tolerates_inner_asyncio_run(monkeypatch):
    """Имитация: alembic.command.upgrade делает asyncio.run(coroutine)."""
    from config import settings
    from db import session

    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+asyncpg://u:p@h/db")

    async def _inner():
        # Эмулируем миграцию: просто что-то сделали
        return None

    called = {"n": 0}

    def fake_upgrade(cfg, rev):
        called["n"] += 1
        # На worker-потоке event loop не запущен, поэтому asyncio.run() валиден.
        asyncio.run(_inner())

    import alembic.command as alembic_cmd
    monkeypatch.setattr(alembic_cmd, "upgrade", fake_upgrade)

    # alembic_ini существует — не короткая выходная ветвь
    await session.run_migrations()
    assert called["n"] == 1


@pytest.mark.asyncio
async def test_run_migrations_retries_on_transient_failure(monkeypatch):
    """2 первые попытки падают, третья — проходит. Ретраи делают это прозрачно."""
    from config import settings
    from db import session

    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+asyncpg://u:p@h/db")

    attempts = {"n": 0}

    def flaky_upgrade(cfg, rev):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError("postgres not ready yet")

    # Сокращаем ожидание ретраев до нуля, чтобы не тянуть тест.
    real_sleep = asyncio.sleep
    async def fast_sleep(_):
        await real_sleep(0)
    monkeypatch.setattr(session.asyncio, "sleep", fast_sleep)

    import alembic.command as alembic_cmd
    monkeypatch.setattr(alembic_cmd, "upgrade", flaky_upgrade)

    await session.run_migrations()
    assert attempts["n"] == 3


@pytest.mark.asyncio
async def test_run_migrations_skips_when_db_disabled(monkeypatch):
    from config import settings
    from db import session

    monkeypatch.setattr(settings, "DATABASE_URL", "")

    # upgrade не должен быть вызван, если DB отключена
    def should_not_be_called(cfg, rev):
        raise AssertionError("run_migrations invoked command.upgrade with DB disabled")

    import alembic.command as alembic_cmd
    monkeypatch.setattr(alembic_cmd, "upgrade", should_not_be_called)

    await session.run_migrations()
