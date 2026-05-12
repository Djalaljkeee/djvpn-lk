"""Тесты для ensure_telegram_user_session: find-or-create логика SHM.

Покрываем 4 критичных ветки:
1. Существующий пользователь — НЕ должен пытаться создаваться повторно.
2. Новый пользователь — создаётся через PUT, далее логинимся.
3. PUT отдал 409 "already exists" — повторный поиск находит юзера, логинимся.
4. Пароль рассинхронизирован — POST синхронизирует, повторный логин работает.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException


pytestmark = pytest.mark.asyncio


EXISTING_USER = {"user_id": 42, "login": "@123"}


async def _call(**overrides):
    """Утилита: вызвать ensure_telegram_user_session с патченными зависимостями.

    overrides — словарь side_effect/return_value для:
      shm_request, shm_password_login, get_admin_session
    """
    from shm_client import ensure_telegram_user_session

    with (
        patch("shm_client.get_admin_session", new=AsyncMock(return_value="ADMIN_SESS")),
        patch("shm_client.shm_request", new=AsyncMock()) as mock_req,
        patch("shm_client.shm_password_login", new=AsyncMock()) as mock_login,
    ):
        if "shm_request" in overrides:
            mock_req.side_effect = overrides["shm_request"]
        if "shm_password_login" in overrides:
            mock_login.side_effect = overrides["shm_password_login"]

        try:
            session = await ensure_telegram_user_session(
                tg_id=123, display_name="Test User", partner_id=None,
            )
        except Exception as exc:
            return exc, mock_req, mock_login
        return session, mock_req, mock_login


async def test_existing_user_does_not_recreate():
    """Юзер уже есть → используем его, PUT не вызывается."""
    result, mock_req, mock_login = await _call(
        shm_request=[{"data": [EXISTING_USER]}],   # GET admin/user
        shm_password_login=["EXISTING_SESSION"],   # login OK
    )
    assert result == "EXISTING_SESSION"

    methods_paths = [
        (call.args[0], call.args[1]) for call in mock_req.await_args_list
    ]
    assert ("GET", "/shm/v1/admin/user") in methods_paths
    # Не должно быть никаких PUT/POST — создание не выполнялось.
    for method, path in methods_paths:
        assert method != "PUT", f"Не должен был дёргать PUT, а дёрнул: {methods_paths}"


async def test_new_user_is_created():
    """Юзера нет → PUT создаёт → логин успешен."""
    result, mock_req, mock_login = await _call(
        shm_request=[
            {"data": []},   # GET — пусто
            {},             # PUT — успешно создан
        ],
        shm_password_login=["NEW_SESSION"],
    )
    assert result == "NEW_SESSION"

    methods = [call.args[0] for call in mock_req.await_args_list]
    assert "GET" in methods
    assert "PUT" in methods


async def test_put_conflict_then_relogin():
    """PUT падает с 409 'already exists' → повторный GET находит → логин."""
    result, mock_req, mock_login = await _call(
        shm_request=[
            {"data": []},                                              # GET — пусто
            HTTPException(status_code=409, detail="User already exists"),  # PUT — 409
            {"data": [EXISTING_USER]},                                  # повторный GET
        ],
        shm_password_login=["RECOVERED_SESSION"],
    )
    assert result == "RECOVERED_SESSION"

    methods = [call.args[0] for call in mock_req.await_args_list]
    # Ожидаем: GET → PUT → GET (повторный)
    assert methods == ["GET", "PUT", "GET"]


async def test_password_desync_triggers_resync():
    """Юзер найден, но логин не прошёл → POST синхронизирует → второй логин ок."""
    result, mock_req, mock_login = await _call(
        shm_request=[
            {"data": [EXISTING_USER]},   # GET — найден
            {},                          # POST — синхронизация пароля
        ],
        shm_password_login=[None, "RESYNCED_SESSION"],  # 1-й fail, 2-й ok
    )
    assert result == "RESYNCED_SESSION"

    methods_paths = [
        (call.args[0], call.args[1]) for call in mock_req.await_args_list
    ]
    assert methods_paths == [
        ("GET", "/shm/v1/admin/user"),
        ("POST", "/shm/v1/admin/user"),
    ]
    assert mock_login.await_count == 2


async def test_put_non_conflict_error_propagates():
    """PUT падает с 500 (не дубль) → исключение наверх, повторного поиска нет."""
    result, mock_req, mock_login = await _call(
        shm_request=[
            {"data": []},   # GET — пусто
            HTTPException(status_code=500, detail="SHM internal error"),
        ],
    )
    assert isinstance(result, HTTPException)
    assert result.status_code == 500

    methods = [call.args[0] for call in mock_req.await_args_list]
    # Только GET + PUT, без повторного GET (это не conflict).
    assert methods == ["GET", "PUT"]
