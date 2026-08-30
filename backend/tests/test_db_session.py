"""Сессия БД: транзакция должна доезжать до коммита.

Регрессия: обработчики брали сессию как `async for db in _db(): … return`.
Брошенный на `return` асинхронный генератор дочитывает сборщик мусора, поэтому
код после `yield` — сам `commit()` — не выполнялся, и кабинет отвечал 200 на
запись, которую тут же откатывал.
"""

from __future__ import annotations

import glob
import os

import pytest

import db.session as session_module
from db import db_session


class _FakeSession:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def commit(self) -> None:
        self.commits += 1

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.fixture
def fake_session(monkeypatch):
    fake = _FakeSession()
    monkeypatch.setattr(session_module, "_session_factory", lambda: fake)
    return fake


async def test_early_return_still_commits(fake_session):
    async def handler():
        async with db_session():
            return "готово"

    assert await handler() == "готово"
    assert (fake_session.commits, fake_session.rollbacks) == (1, 0)


async def test_exception_rolls_back(fake_session):
    with pytest.raises(ValueError):
        async with db_session():
            raise ValueError("боом")

    assert (fake_session.commits, fake_session.rollbacks) == (0, 1)


def test_routers_take_the_session_as_a_context_manager():
    """Тот же баг вернётся молча — ловим его по форме вызова."""
    here = os.path.dirname(os.path.abspath(__file__))
    for path in glob.glob(os.path.join(here, "..", "routers", "*.py")):
        source = open(path, encoding="utf-8").read()
        assert "async for db in _db()" not in source, os.path.basename(path)
