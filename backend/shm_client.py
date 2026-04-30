"""SHM API client helpers."""

import base64
import hashlib
import logging
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings


async def get_admin_session() -> str:
    """Получить admin session_id от SHM."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": settings.SHM_ADMIN_LOGIN, "password": settings.SHM_ADMIN_PASSWORD},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=503, detail="Не удалось получить admin-сессию SHM")
    return resp.json().get("session_id")


async def shm_request(
    method: str,
    path: str,
    session_id: str,
    json_data: dict = None,
    params: dict = None,
) -> dict:
    url = f"{settings.SHM_BASE_URL}{path}"
    headers = {
        "session-id": session_id,
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.request(
            method, url, headers=headers, json=json_data, params=params,
        )
    if resp.status_code in (200, 201):
        if resp.content:
            return resp.json()
        return {}
    if resp.status_code == 404:
        return {}
    logging.warning("SHM %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
    raise HTTPException(status_code=resp.status_code, detail=resp.text)


async def shm_password_login(login: str, password: str) -> Optional[str]:
    """Логин в SHM по логину/паролю. Возвращает session_id или None."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": login, "password": password},
        )
    if resp.status_code != 200:
        return None
    return resp.json().get("session_id")


def tg_user_password(tg_id: int) -> str:
    """Стабильный пароль для TG-пользователей — зависит от bot token, не от JWT_SECRET."""
    raw = f"{settings.TELEGRAM_BOT_TOKEN}:{tg_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def find_exact_shm_login(users: list[dict], expected_login: str) -> Optional[dict]:
    """SHM search may return partial matches, so we keep only exact login hits."""
    for user in users:
        if (user.get("login") or "").strip() == expected_login:
            return user
    return None


def shm_basic_auth_header() -> str:
    """HTTP Basic-заголовок для admin endpoints SHM."""
    raw = f"{settings.SHM_ADMIN_LOGIN}:{settings.SHM_ADMIN_PASSWORD}".encode()
    return f"Basic {base64.b64encode(raw).decode()}"


async def shm_public_register(
    login: str,
    password: str,
    name: str,
    email: str,
    captcha_cookie: str,
    captcha_code: Optional[str],
    partner_id: Optional[int] = None,
) -> Optional[str]:
    """Публичная регистрация через SHM PUT /shm/v1/user с проксированием
    капча-cookie. Возвращает session_id или None, если SHM не принял запрос.
    """
    url = f"{settings.SHM_BASE_URL}/shm/v1/user"
    body: dict = {
        "login":    login,
        "password": password,
        "name":     name,
        "email":    email,
    }
    if partner_id:
        body["partner_id"] = partner_id
    if captcha_code:
        body["captcha"] = captcha_code
        body["captcha_code"] = captcha_code

    cookies = {"session_id": captcha_cookie} if captcha_cookie else {}

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.put(url, json=body, cookies=cookies)
    except Exception as exc:
        logging.warning("public register: SHM error: %s", exc)
        return None

    if resp.status_code in (200, 201):
        try:
            data = resp.json()
        except Exception:
            data = {}
        # SHM может вернуть session_id сразу, либо только статус
        sid = data.get("session_id") if isinstance(data, dict) else None
        if not sid and isinstance(data, dict):
            data_list = data.get("data")
            if isinstance(data_list, list) and data_list and isinstance(data_list[0], dict):
                sid = data_list[0].get("session_id")
        if sid:
            return sid
        # PUT /shm/v1/user отдаёт user-данные без session_id — логинимся
        # тем же паролем, чтобы получить сессию.
        sid = await shm_password_login(login, password)
        if sid:
            return sid
        logging.error("public register: user created but auto-login failed for %s", login)
        raise HTTPException(
            status_code=500,
            detail="Аккаунт создан, но не удалось войти. Попробуйте войти вручную.",
        )

    detail = resp.text[:300]
    logging.warning("public register: SHM %s: %s", resp.status_code, detail)
    low = detail.lower()
    if "captcha" in low or "капч" in low:
        raise HTTPException(status_code=400, detail="Неверная капча")
    if "exist" in low or "уже" in low or resp.status_code == 409:
        raise HTTPException(status_code=400, detail="Пользователь с таким email уже зарегистрирован")
    return None
