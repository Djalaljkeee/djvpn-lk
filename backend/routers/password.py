"""Смена пароля клиентом из Telegram Mini App на SHM 3.x.

SHM 3.x требует `old_password` в `POST /user/passwd`, если у пользователя уже
есть пароль. У клиентов, зарегистрированных через Telegram, пароль случайный и
им неизвестен, поэтому сценарий «задайте пароль» из бота без этой ручки
перестаёт работать.

Ручка меняет пароль через `POST /admin/user/passwd` ограниченным Bearer-токеном
SHM (`SHM_PASSWD_TOKEN`): в SHM токен должен принадлежать отдельному
пользователю в группе с `default_policy: deny` и единственным правилом
allow `POST /admin/user/passwd`, плюс ограничение по IP этого сервера.
Без токена ручка выключена (503) — на SHM 2.x она и не нужна.

Кому можно: только владельцу текущей SHM-сессии и только если он докажет
владение Telegram-аккаунтом свежей подписью `initData` Mini App, а Telegram id
из подписи совпадёт с привязанным к пользователю SHM.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Optional
from urllib.parse import parse_qsl

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from config import settings
from http_retry import request_with_connect_retry
from logging_config import get_logger
from rate_limit import limiter, session_key_func
from routers.support import _telegram_id_from
from security import get_current_session
from shm_client import get_shm_client, shm_request

log = get_logger(__name__)
router = APIRouter()

# Mini App открывается из бота по ссылке — подпись старше часа не принимаем,
# чтобы утёкший initData нельзя было переиграть позже.
INIT_DATA_MAX_AGE_S = 3600

# Группы SHM, которым разрешено менять пароль этой ручкой: 2 — «users» в 3.x,
# 0/None — пользователи без группы в 2.x. Админов и операторов не трогаем,
# даже если токен это позволяет.
CLIENT_GIDS = {None, 0, 2}


class PasswordIn(BaseModel):
    password: str = Field(min_length=6, max_length=128)
    init_data: str = Field(min_length=1, max_length=4096)


def verify_init_data(init_data: str, bot_token: str, now: Optional[float] = None) -> Optional[int]:
    """Telegram id из подписанного initData Mini App или None, если подпись не сходится."""
    if not bot_token:
        return None
    fields = dict(parse_qsl(init_data, keep_blank_values=True))
    received = fields.pop("hash", "")
    if not received:
        return None
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    try:
        auth_date = int(fields.get("auth_date", "0"))
        tg_id = int(json.loads(fields.get("user", "{}")).get("id"))
    except (TypeError, ValueError):
        return None
    if abs((now or time.time()) - auth_date) > INIT_DATA_MAX_AGE_S:
        return None
    return tg_id


def _gid(user: dict) -> Optional[int]:
    try:
        return int(user["gid"]) if user.get("gid") is not None else None
    except (TypeError, ValueError):
        return -1


@router.post("/api/user/password")
@limiter.limit("5/hour", key_func=session_key_func)
async def change_password(
    request: Request,
    payload: PasswordIn,
    session: dict = Depends(get_current_session),
):
    if not settings.SHM_PASSWD_TOKEN:
        raise HTTPException(status_code=503, detail="Смена пароля без текущего недоступна")

    tg_id = verify_init_data(payload.init_data, settings.TELEGRAM_BOT_TOKEN)
    if tg_id is None:
        raise HTTPException(status_code=403, detail="Откройте смену пароля из Telegram-бота")

    data = await shm_request("GET", "/shm/v1/user", session["shm_session"])
    user = (data.get("data") or [{}])[0]
    user_id = int(user.get("user_id") or 0)
    if not user_id or user_id != session["user_id"]:
        raise HTTPException(status_code=401, detail="SHM session invalid")

    settings_blob = user.get("settings") or {}
    if isinstance(settings_blob, str):
        try:
            settings_blob = json.loads(settings_blob)
        except ValueError:
            settings_blob = {}
    shm_tg_id = _telegram_id_from(str(user.get("login") or ""), settings_blob.get("telegram") or {})
    if shm_tg_id != tg_id:
        log.warning("password.tg_mismatch", user_id=user_id)
        raise HTTPException(status_code=403, detail="Telegram-аккаунт не привязан к этому кабинету")

    if _gid(user) not in CLIENT_GIDS:
        log.warning("password.non_client_group", user_id=user_id, gid=user.get("gid"))
        raise HTTPException(status_code=403, detail="Смена пароля для этой учётной записи недоступна")

    url = f"{settings.SHM_BASE_URL}/shm/v1/admin/user/passwd"
    try:
        resp = await request_with_connect_retry(
            get_shm_client(), "POST", url, label="/admin/user/passwd",
            headers={"Authorization": f"Bearer {settings.SHM_PASSWD_TOKEN}"},
            json={"user_id": user_id, "password": payload.password},
        )
    except httpx.RequestError as exc:
        log.warning("password.shm_unreachable", error=type(exc).__name__)
        raise HTTPException(status_code=502, detail="SHM upstream unreachable")

    if resp.status_code not in (200, 201):
        # Тело не логируем целиком: там может оказаться эхо запроса.
        log.warning("password.shm_failed", user_id=user_id, status=resp.status_code)
        raise HTTPException(status_code=502, detail="Не удалось сменить пароль")

    log.info("password.changed_via_token", user_id=user_id)
    return {"ok": True}
