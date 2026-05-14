"""Юнит-тесты прокси SHM: извлечение session-токена из тела ответа.

SHM-эндпоинты `/v1/user/auth` и `/v1/telegram/*/auth` отдают сессию в JSON
как {"id": "..."}, а не через Set-Cookie. Без этой обработки cookie session_id
никогда не появится на ЛК и каждый следующий запрос ловит 401.
"""

from __future__ import annotations

import httpx

from routers.shm_proxy import _extract_body_session


def _resp(status: int, content: bytes) -> httpx.Response:
    return httpx.Response(status_code=status, content=content)


def test_extracts_id_from_user_auth() -> None:
    resp = _resp(200, b'{"id":"I2WqRSaAt79f1X4h77gSGN3UC07GiTG6"}')
    assert _extract_body_session("v1/user/auth", resp) == "I2WqRSaAt79f1X4h77gSGN3UC07GiTG6"


def test_extracts_id_from_telegram_webapp_auth() -> None:
    resp = _resp(200, b'{"id":"abc123"}')
    assert _extract_body_session("v1/telegram/webapp/auth", resp) == "abc123"


def test_skips_non_auth_path() -> None:
    # На `/v1/user` поле id — это user_id (int) или другая сущность; в cookie
    # такое лить нельзя, поэтому non-auth пути молча возвращают None.
    resp = _resp(200, b'{"id":"some_value"}')
    assert _extract_body_session("v1/user", resp) is None


def test_skips_non_200() -> None:
    resp = _resp(401, b'{"id":"unused"}')
    assert _extract_body_session("v1/user/auth", resp) is None


def test_handles_non_json_body() -> None:
    resp = _resp(200, b'<html>not json</html>')
    assert _extract_body_session("v1/user/auth", resp) is None


def test_handles_missing_id() -> None:
    resp = _resp(200, b'{"status":"ok"}')
    assert _extract_body_session("v1/user/auth", resp) is None


def test_handles_non_string_id() -> None:
    # Если SHM когда-то отдаст числовой id — это не session-token, не трогаем.
    resp = _resp(200, b'{"id":12345}')
    assert _extract_body_session("v1/user/auth", resp) is None


def test_handles_empty_id() -> None:
    resp = _resp(200, b'{"id":""}')
    assert _extract_body_session("v1/user/auth", resp) is None
