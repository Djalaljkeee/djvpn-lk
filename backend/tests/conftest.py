"""Общие фикстуры pytest.

Запускаем тесты из корня backend/: `cd backend && pytest`.
БД/Redis не требуются — все компоненты имеют in-memory/opt-out режимы.
"""

from __future__ import annotations

import os
import sys

import pytest


# Корень backend попадает в sys.path (как при запуске uvicorn main:app)
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


@pytest.fixture
def client():
    """FastAPI TestClient в рамках жизненного цикла приложения."""
    from fastapi.testclient import TestClient
    import main

    with TestClient(main.app) as tc:
        yield tc
