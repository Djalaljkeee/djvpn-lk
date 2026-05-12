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


async def find_telegram_user(admin_session: str, tg_id: int) -> Optional[dict]:
    """Точный поиск SHM-юзера с login=@{tg_id}. None если не найден."""
    tg_login = f"@{tg_id}"
    users_data = await shm_request(
        "GET", "/shm/v1/admin/user", admin_session, params={"login": tg_login}
    )
    return find_exact_shm_login(users_data.get("data", []) or [], tg_login)


async def login_telegram_user(
    admin_session: str, shm_user: dict, tg_password: str
) -> Optional[str]:
    """Логин существующего TG-юзера с авто-синхронизацией пароля.

    Если пароль в SHM руками поменяли (или он рассинхронился по другой
    причине) — перезаписываем его на стабильный tg_user_password и логинимся
    повторно. None если синхронизация тоже не помогла.
    """
    shm_uid = shm_user.get("user_id")
    shm_login = shm_user.get("login")
    if not shm_login:
        return None
    session = await shm_password_login(shm_login, tg_password)
    if session:
        return session
    logging.warning(
        "TG login: синхронизируем пароль для uid=%s login=%s", shm_uid, shm_login
    )
    await shm_request(
        "POST", "/shm/v1/admin/user", admin_session,
        json_data={"user_id": shm_uid, "login": shm_login, "password": tg_password},
    )
    return await shm_password_login(shm_login, tg_password)


def _is_already_exists_error(exc: HTTPException) -> bool:
    """SHM иногда отдаёт «уже существует» как 400 или 409 с произвольным текстом."""
    detail = str(exc.detail or "").lower()
    return (
        exc.status_code in (400, 409)
        and ("exist" in detail or "уже" in detail or "duplicate" in detail)
    )


async def ensure_telegram_user_session(
    *,
    tg_id: int,
    display_name: str,
    partner_id: Optional[int] = None,
) -> str:
    """Find-or-create SHM-юзера по `@{tg_id}` и вернуть его session_id.

    Раньше код пытался PUT-ить пользователя без предварительной проверки —
    SHM падал на дубле и raw-ошибка летела клиенту. Здесь сначала ищем,
    потом создаём, и страхуемся повторным поиском если SHM всё же ответил
    "already exists" (race / sticky cache).
    """
    tg_login = f"@{tg_id}"
    tg_password = tg_user_password(tg_id)
    admin_session = await get_admin_session()

    existing = await find_telegram_user(admin_session, tg_id)
    if existing:
        session = await login_telegram_user(admin_session, existing, tg_password)
        if session:
            return session
        raise HTTPException(
            status_code=401,
            detail="Не удалось войти после синхронизации пароля",
        )

    create_payload: dict = {
        "login": tg_login,
        "password": tg_password,
        "name": display_name,
    }
    if partner_id:
        create_payload["partner_id"] = partner_id

    try:
        await shm_request(
            "PUT", "/shm/v1/admin/user", admin_session, json_data=create_payload
        )
    except HTTPException as exc:
        if not _is_already_exists_error(exc):
            raise
        existing = await find_telegram_user(admin_session, tg_id)
        if not existing:
            raise
        session = await login_telegram_user(admin_session, existing, tg_password)
        if session:
            return session
        raise HTTPException(
            status_code=401,
            detail="Не удалось войти после синхронизации пароля",
        )

    logging.info("TG auth: создан пользователь %s (partner_id=%s)", tg_login, partner_id)
    session = await shm_password_login(tg_login, tg_password)
    if not session:
        raise HTTPException(
            status_code=401,
            detail="Аккаунт создан, но не удалось войти",
        )
    return session


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
