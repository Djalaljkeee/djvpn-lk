"""Alembic environment.

Работает и в online (через async-engine), и в offline режимах.
Берёт URL из `DATABASE_URL` окружения либо из `alembic.ini`.
"""

from __future__ import annotations

import asyncio
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config


# Backend-модуль должен быть импортируемым
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from db.base import Base  # noqa: E402
from db import models as _models  # noqa: E402,F401  # регистрирует модели в Base.metadata


config = context.config

if config.config_file_name:
    try:
        fileConfig(config.config_file_name)
    except Exception:
        # В контейнере могут отсутствовать logging-секции — не критично
        pass


def _get_url() -> str:
    env_url = os.environ.get("DATABASE_URL") or ""
    if env_url:
        if env_url.startswith("postgresql://"):
            env_url = "postgresql+asyncpg://" + env_url[len("postgresql://"):]
        elif env_url.startswith("postgres://"):
            env_url = "postgresql+asyncpg://" + env_url[len("postgres://"):]
        return env_url
    return config.get_main_option("sqlalchemy.url") or ""


target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = _get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    url = _get_url()
    configuration = config.get_section(config.config_ini_section) or {}
    configuration["sqlalchemy.url"] = url

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
