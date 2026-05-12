"""SHM API client helpers."""

import base64
import hashlib
import logging
from typing import Optional

import httpx
from fastapi import HTTPException

from config import settings
from logging_config import client_ip_ctx


def _proxy_headers() -> dict:
    ip = client_ip_ctx.get()
    if not ip:
        return {}
    return {"X-Forwarded-For": ip, "X-Real-IP": ip}


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
        **_proxy_headers(),
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
            headers=_proxy_headers(),
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


async def _admin_reset_tg_password(tg_login: str, new_password: str) -> Optional[str]:
    """Сбросить пароль TG-юзера через admin API и залогиниться.

    Нужно когда пользователь существует в SHM, но с не-детерминированным паролем
    (изменил вручную, или сменился TELEGRAM_BOT_TOKEN). Возвращает session_id или None.
    """
    try:
        admin_session = await get_admin_session()
        data = await shm_request(
            "GET", "/shm/v1/admin/user", admin_session, params={"login": tg_login}
        )
        users = data.get("data") or []
        user = find_exact_shm_login(users, tg_login)
        if not user:
            logging.warning("TG auth: admin search не нашёл %s", tg_login)
            return None
        user_id = user.get("user_id")
        if not user_id:
            return None
        await shm_request(
            "PUT", "/shm/v1/admin/user", admin_session,
            json_data={"user_id": user_id, "password": new_password},
        )
        return await shm_password_login(tg_login, new_password)
    except Exception as exc:
        logging.warning("TG auth: admin password reset failed for %s: %s", tg_login, exc)
        return None


async def ensure_telegram_user_session(
    *,
    tg_id: int,
    display_name: str,
    partner_id: Optional[int] = None,
) -> str:
    """Login-first для Telegram-юзера через публичный SHM API.

    Алгоритм:
    1. POST /shm/user/auth.cgi с (@{tg_id}, tg_user_password). 200 — юзер
       есть и пароль детерминированный, возвращаем session.
    2. Иначе — PUT /shm/v1/user (публичная регистрация без captcha/email).
       Создаст нового юзера ИЛИ упрётся в "already exists" если юзер
       менял пароль через UI/email-флоу или сменился bot token.
    3. При "already exists" — пробуем сбросить пароль через admin API.
    4. Любая ошибка превращается в человеческое сообщение клиенту.
    """
    tg_login = f"@{tg_id}"
    tg_password = tg_user_password(tg_id)

    session = await shm_password_login(tg_login, tg_password)
    if session:
        return session

    try:
        session = await shm_public_register(
            login=tg_login,
            password=tg_password,
            name=display_name,
            email=None,
            captcha_cookie="",
            captcha_code=None,
            partner_id=partner_id,
        )
    except HTTPException as exc:
        detail = str(exc.detail or "")
        if exc.status_code in (400, 409) and ("уже" in detail or "exist" in detail.lower()):
            logging.warning("TG auth: %s exists with different password, trying admin reset", tg_login)
            session = await _admin_reset_tg_password(tg_login, tg_password)
            if session:
                return session
            raise HTTPException(
                status_code=401,
                detail=(
                    "Не удалось войти через Telegram: пароль изменён. "
                    "Войдите по логину и паролю или восстановите доступ."
                ),
            )
        raise

    if not session:
        raise HTTPException(
            status_code=502,
            detail="SHM не вернул сессию после регистрации Telegram-юзера",
        )

    logging.info("TG auth: создан пользователь %s (partner_id=%s)", tg_login, partner_id)
    return session


def shm_basic_auth_header() -> str:
    """HTTP Basic-заголовок для admin endpoints SHM."""
    raw = f"{settings.SHM_ADMIN_LOGIN}:{settings.SHM_ADMIN_PASSWORD}".encode()
    return f"Basic {base64.b64encode(raw).decode()}"


async def shm_public_register(
    login: str,
    password: str,
    name: str,
    email: Optional[str] = None,
    captcha_cookie: str = "",
    captcha_code: Optional[str] = None,
    partner_id: Optional[int] = None,
) -> Optional[str]:
    """Публичная регистрация через SHM PUT /shm/v1/user.

    Для email-регистрации передаём `email` + captcha (cookie+code из
    /api/captcha). Для Telegram-регистрации email/captcha не нужны —
    SHM принимает запрос без них.

    Возвращает session_id или None, если SHM не принял запрос.
    """
    url = f"{settings.SHM_BASE_URL}/shm/v1/user"
    body: dict = {
        "login":    login,
        "password": password,
        "name":     name,
    }
    if email:
        body["email"] = email
    if partner_id:
        body["partner_id"] = partner_id
    if captcha_code:
        body["captcha"] = captcha_code
        body["captcha_code"] = captcha_code

    cookies = {"session_id": captcha_cookie} if captcha_cookie else {}

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.put(url, json=body, cookies=cookies, headers=_proxy_headers())
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
