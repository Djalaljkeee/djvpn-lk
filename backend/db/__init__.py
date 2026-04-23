"""Database package: SQLAlchemy async engine, ORM models, session helpers.

Вся работа с БД опциональна — если `DATABASE_URL` пуст, модуль
не создаёт движок и функции возвращают `None`/бросают HTTPException,
не ломая остальной бэкенд.
"""

from db.session import (
    db_enabled,
    get_db_session,
    init_engine,
    run_migrations,
    shutdown_engine,
)

__all__ = [
    "db_enabled",
    "get_db_session",
    "init_engine",
    "run_migrations",
    "shutdown_engine",
]
