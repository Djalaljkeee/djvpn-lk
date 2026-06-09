"""Юнит-тесты прокси SHM: извлечение session-токена из тела ответа.

SHM-эндпоинты `/v1/user/auth` и `/v1/telegram/*/auth` отдают сессию в JSON
(не Set-Cookie). При этом имя поля различается между эндпоинтами:
`POST /user/auth` — `{"id": "..."}`, `GET /telegram/webapp/auth` —
`{"session_id": "..."}`. Без обработки обоих cookie session_id никогда не
появится на ЛК и каждый следующий запрос ловит 401.
"""

from __future__ import annotations

import httpx
from starlette.responses import Response

from routers.shm_proxy import _append_session_cookie, _extract_body_session


def _resp(status: int, content: bytes) -> httpx.Response:
    return httpx.Response(status_code=status, content=content)


def test_extracts_id_from_user_auth() -> None:
    resp = _resp(200, b'{"id":"I2WqRSaAt79f1X4h77gSGN3UC07GiTG6"}')
    assert _extract_body_session("v1/user/auth", resp) == "I2WqRSaAt79f1X4h77gSGN3UC07GiTG6"


def test_extracts_id_from_telegram_webapp_auth() -> None:
    resp = _resp(200, b'{"id":"abc123"}')
    assert _extract_body_session("v1/telegram/webapp/auth", resp) == "abc123"


def test_extracts_session_id_field_from_webapp_auth() -> None:
    # Реальный ответ SHM на GET /telegram/webapp/auth содержит session_id,
    # а не id (см. лог боевого окружения, 401 на следующем /user).
    resp = _resp(200, b'{"session_id":"EgwC3w9bKaOa1RmCtKaWIsf41wGw7YIu"}')
    assert _extract_body_session("v1/telegram/webapp/auth", resp) == \
        "EgwC3w9bKaOa1RmCtKaWIsf41wGw7YIu"


def test_prefers_session_id_over_id_when_both_present() -> None:
    # Если SHM вдруг отдаёт оба — session_id это явный session-token,
    # тогда как id может быть user_id; берём первый.
    resp = _resp(200, b'{"session_id":"sess","id":"user42"}')
    assert _extract_body_session("v1/user/auth", resp) == "sess"


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


def _set_cookie_value(response: Response) -> str:
    # Starlette складывает каждый Set-Cookie отдельной парой в response.raw_headers
    headers = [
        v.decode("latin-1")
        for k, v in response.raw_headers
        if k.decode("latin-1").lower() == "set-cookie"
    ]
    assert len(headers) == 1, headers
    return headers[0]


def test_session_cookie_uses_samesite_none_partitioned_under_https() -> None:
    # Telegram WebApp в браузере (web.telegram.org → iframe lk.djvpn.ru) =
    # кросс-сайт. Cookie должна быть SameSite=None; Secure; Partitioned (CHIPS),
    # иначе Chrome/Yandex её выбросят и каждый следующий /user поймает 401.
    response = Response()
    _append_session_cookie(response, "session_id", "sess123", 3600, is_secure=True)
    raw = _set_cookie_value(response)
    assert raw.startswith("session_id=sess123")
    assert "Path=/" in raw
    assert "Max-Age=3600" in raw
    assert "HttpOnly" in raw
    assert "Secure" in raw
    assert "SameSite=None" in raw
    assert "Partitioned" in raw
    # Под HTTPS не должно быть SameSite=Lax — иначе кросс-сайт iframe сломается.
    assert "SameSite=Lax" not in raw


def test_session_cookie_falls_back_to_lax_under_http() -> None:
    # На локальной разработке (HTTP) SameSite=None невозможен без Secure.
    # Откатываемся на Lax, контекст всё равно same-site → работает.
    response = Response()
    _append_session_cookie(response, "session_id", "sess", None, is_secure=False)
    raw = _set_cookie_value(response)
    assert "SameSite=Lax" in raw
    assert "Secure" not in raw
    assert "SameSite=None" not in raw
    assert "Partitioned" not in raw
    # Max-Age=None — атрибут отсутствует, кука становится session-only
    assert "Max-Age" not in raw
