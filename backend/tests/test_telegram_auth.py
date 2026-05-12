"""Тесты для ensure_telegram_user_session — login-first через публичный SHM API.

Алгоритм:
1. shm_password_login → если 200, готово (горячий путь).
2. Иначе shm_public_register (PUT /shm/v1/user без email/captcha).
3. Если SHM ответил "already exists" — это значит юзер сам менял пароль,
   возвращаем понятную 401 клиенту, без auto-resync.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException


pytestmark = pytest.mark.asyncio


async def _call(*, login_side_effect, register_side_effect=None):
    """Вызвать ensure_telegram_user_session с патченными зависимостями.

    Возвращает (result_or_exc, mock_login, mock_register).
    """
    from shm_client import ensure_telegram_user_session

    with (
        patch("shm_client.shm_password_login", new=AsyncMock()) as mock_login,
        patch("shm_client.shm_public_register", new=AsyncMock()) as mock_register,
    ):
        mock_login.side_effect = login_side_effect
        if register_side_effect is not None:
            mock_register.side_effect = register_side_effect

        try:
            session = await ensure_telegram_user_session(
                tg_id=123, display_name="Test User", partner_id=None,
            )
        except Exception as exc:
            return exc, mock_login, mock_register
        return session, mock_login, mock_register


async def test_existing_user_logs_in_hot_path():
    """Юзер есть и пароль детерминированный → один shm_password_login, без register."""
    result, mock_login, mock_register = await _call(
        login_side_effect=["EXISTING_SESSION"],
    )
    assert result == "EXISTING_SESSION"
    mock_login.assert_awaited_once()
    mock_register.assert_not_awaited()


async def test_new_user_registers_and_returns_session():
    """Юзера нет → shm_public_register создаёт и возвращает session."""
    result, mock_login, mock_register = await _call(
        login_side_effect=[None],
        register_side_effect=["NEW_SESSION"],
    )
    assert result == "NEW_SESSION"
    mock_login.assert_awaited_once()
    mock_register.assert_awaited_once()

    # Проверяем что email/captcha не пробрасываются для TG-регистрации
    kwargs = mock_register.await_args.kwargs
    assert kwargs["login"] == "@123"
    assert kwargs.get("email") is None
    assert kwargs.get("captcha_code") is None


async def test_password_changed_returns_clean_401():
    """shm_public_register бросает «уже зарегистрирован» → 401 с понятным текстом."""
    result, mock_login, mock_register = await _call(
        login_side_effect=[None],
        register_side_effect=[
            HTTPException(status_code=400, detail="Пользователь с таким email уже зарегистрирован"),
        ],
    )
    assert isinstance(result, HTTPException)
    assert result.status_code == 401
    assert "пароль" in str(result.detail).lower()
    # Не raw-текст SHM
    assert "email" not in str(result.detail).lower()


async def test_register_returns_none_raises_502():
    """shm_public_register вернул None (SHM не принял запрос без HTTPException) → 502."""
    result, mock_login, mock_register = await _call(
        login_side_effect=[None],
        register_side_effect=[None],
    )
    assert isinstance(result, HTTPException)
    assert result.status_code == 502


async def test_register_unknown_error_propagates():
    """SHM 500/прочие ошибки прокидываем без замены на 401."""
    result, mock_login, mock_register = await _call(
        login_side_effect=[None],
        register_side_effect=[
            HTTPException(status_code=500, detail="SHM internal error"),
        ],
    )
    assert isinstance(result, HTTPException)
    assert result.status_code == 500
    assert "internal" in str(result.detail).lower()


async def test_partner_id_propagates_to_register():
    """partner_id должен пробрасываться в shm_public_register при создании."""
    from shm_client import ensure_telegram_user_session

    with (
        patch("shm_client.shm_password_login", new=AsyncMock(return_value=None)),
        patch("shm_client.shm_public_register", new=AsyncMock(return_value="S")) as mock_register,
    ):
        await ensure_telegram_user_session(
            tg_id=123, display_name="Test", partner_id=42,
        )

    assert mock_register.await_args.kwargs.get("partner_id") == 42
