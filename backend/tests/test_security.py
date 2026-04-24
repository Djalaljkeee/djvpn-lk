"""JWT roundtrip и Telegram HMAC verification."""

import hashlib
import hmac
import time

import pytest
from fastapi import HTTPException

from security import create_token, decode_token


def test_jwt_roundtrip():
    token = create_token("sess-123", 42)
    payload = decode_token(token)
    assert payload["shm_session"] == "sess-123"
    assert payload["user_id"] == 42


def test_decode_token_rejects_garbage():
    with pytest.raises(HTTPException) as exc:
        decode_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_verify_telegram_auth_happy_path(monkeypatch):
    import telegram_auth
    from models import TelegramAuthRequest

    token = "1234:test_bot_token"
    monkeypatch.setattr(telegram_auth.settings, "TELEGRAM_BOT_TOKEN", token)

    data = {
        "auth_date": int(time.time()),
        "id": 99,
        "first_name": "Alice",
        "username": "alice",
    }
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(token.encode()).digest()
    data["hash"] = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    req = TelegramAuthRequest(**data)
    assert telegram_auth.verify_telegram_auth(req) is True


def test_verify_telegram_auth_rejects_bad_hash(monkeypatch):
    import telegram_auth
    from models import TelegramAuthRequest

    monkeypatch.setattr(telegram_auth.settings, "TELEGRAM_BOT_TOKEN", "abc:xyz")
    req = TelegramAuthRequest(
        auth_date=int(time.time()),
        id=1,
        hash="0" * 64,
    )
    assert telegram_auth.verify_telegram_auth(req) is False


def test_verify_telegram_auth_rejects_expired(monkeypatch):
    import telegram_auth
    from models import TelegramAuthRequest

    token = "abc:xyz"
    monkeypatch.setattr(telegram_auth.settings, "TELEGRAM_BOT_TOKEN", token)

    data = {"auth_date": int(time.time()) - 2 * 86400, "id": 1}
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret_key = hashlib.sha256(token.encode()).digest()
    data["hash"] = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    req = TelegramAuthRequest(**data)
    assert telegram_auth.verify_telegram_auth(req) is False
