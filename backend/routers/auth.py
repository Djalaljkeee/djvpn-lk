"""Authentication: login, Telegram widget, Mini App WebApp, registration."""

import base64
import hashlib
import hmac
import json
import logging
from typing import Optional
from urllib.parse import parse_qsl

import httpx
from fastapi import APIRouter, HTTPException, Request

from captcha import unpack_captcha_token
from config import settings
from models import (
    AuthResponse,
    EMAIL_RE,
    LoginRequest,
    RegisterRequest,
    TelegramAuthRequest,
)
from rate_limit import limiter
from security import create_token
from shm_client import (
    _proxy_headers,
    ensure_telegram_user_session,
    get_admin_session,
    shm_basic_auth_header,
    shm_public_register,
    shm_request,
)
from telegram_auth import verify_telegram_auth


router = APIRouter()


@router.post("/api/auth/login", response_model=AuthResponse)
@limiter.limit("10/minute")
async def login(request: Request, req: LoginRequest):
    """Авторизация по логину и паролю через SHM."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": req.login, "password": req.password},
            headers={"Content-Type": "application/json", **_proxy_headers()},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    result = resp.json()
    shm_session = result.get("session_id")
    if not shm_session:
        raise HTTPException(status_code=401, detail="SHM не вернул session_id")

    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = user_data.get("data", [{}])[0] if user_data.get("data") else {}
    user_id = user.get("user_id", 0)

    token = create_token(shm_session, user_id)
    return {"token": token, "user": user}


@router.post("/api/auth/telegram", response_model=AuthResponse)
@limiter.limit("20/minute")
async def telegram_auth(request: Request, req: TelegramAuthRequest):
    """Авторизация через Telegram Login Widget."""
    # 1. Локальная проверка hash (безопасность)
    if not verify_telegram_auth(req):
        raise HTTPException(status_code=401, detail="Невалидные данные Telegram")

    # 2. Пробуем SHM /shm/v1/telegram/web/auth (прямой метод)
    admin_url = (settings.SHM_ADMIN_URL or settings.SHM_BASE_URL).rstrip("/")
    payload: dict = {"id": str(req.id), "auth_date": str(req.auth_date), "hash": req.hash}
    if req.first_name: payload["first_name"] = req.first_name
    if req.last_name:  payload["last_name"]  = req.last_name
    if req.username:   payload["username"]   = req.username
    if req.photo_url:  payload["photo_url"]  = req.photo_url
    if req.partner_id: payload["partner_id"] = req.partner_id

    shm_session: Optional[str] = None
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.post(
                f"{admin_url}/shm/v1/telegram/web/auth",
                json=payload,
                headers={"Authorization": shm_basic_auth_header(), **_proxy_headers()},
            )
        logging.info("TG widget SHM → %s: %s", resp.status_code, resp.text[:200])
        if resp.status_code in (200, 201):
            shm_session = resp.json().get("session_id")
    except Exception as exc:
        logging.warning("TG widget SHM error: %s", exc)

    # 3. Fallback: find-or-create через admin API.
    if not shm_session:
        logging.info("TG widget: SHM endpoint не вернул session, fallback")
        display_name = (
            f"{req.first_name or ''} {req.last_name or ''}".strip()
            or req.username
            or f"@{req.id}"
        )
        shm_session = await ensure_telegram_user_session(
            tg_id=req.id,
            display_name=display_name,
            partner_id=req.partner_id,
        )

    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = (user_data.get("data") or [{}])[0]
    logging.info("TG auth: успех id=%s user_id=%s", req.id, user.get("user_id"))
    token = create_token(shm_session, user.get("user_id", 0))
    return {"token": token, "user": user}


@router.get("/api/auth/webapp", response_model=AuthResponse)
@limiter.limit("20/minute")
async def webapp_auth(request: Request, initData: str, partner_id: Optional[int] = None):
    """Авторизация через Telegram Mini App (WebApp).
    Верифицирует initData по HMAC-SHA256 с ключом 'WebAppData'.
    Сначала пробует SHM /shm/v1/telegram/webapp/auth, затем fallback.
    `partner_id` опционален — пробрасывается в SHM при создании нового пользователя.
    """
    # 1. Парсим initData (parse_qsl URL-декодирует значения — это нужно для правильного HMAC)
    params = dict(parse_qsl(initData, keep_blank_values=True))
    received_hash = params.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="initData не содержит hash")

    bot_token = settings.TELEGRAM_BOT_TOKEN.strip()
    if not bot_token:
        logging.error("WebApp auth: TELEGRAM_BOT_TOKEN не задан")
        raise HTTPException(status_code=500, detail="Telegram bot token не настроен")

    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode(),
        hashlib.sha256,
    ).digest()

    params_without_signature = {k: v for k, v in params.items() if k != "signature"}
    matched_variant: Optional[str] = None
    data_check_string = ""
    expected_hash = ""
    for variant_name, variant_params in (
        ("with_signature", params),
        ("without_signature", params_without_signature),
    ):
        candidate_check_string = "\n".join(f"{k}={v}" for k, v in sorted(variant_params.items()))
        candidate_hash = hmac.new(secret_key, candidate_check_string.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(candidate_hash, received_hash):
            matched_variant = variant_name
            data_check_string = candidate_check_string
            expected_hash = candidate_hash
            break

    if matched_variant is None:
        data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
        expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    logging.warning(
        "WebApp HMAC: token=%r...%r len=%d expected=%s... got=%s... variant=%s",
        bot_token[:10], bot_token[-4:], len(bot_token), expected_hash[:8], received_hash[:8], matched_variant or "none"
    )
    if matched_variant is None:
        logging.warning("WebApp HMAC failed. check_string=%r", data_check_string[:500])
        raise HTTPException(status_code=401, detail="Невалидные данные WebApp")

    # 2. Пробуем SHM /shm/v1/telegram/webapp/auth (прямой метод)
    admin_url = (settings.SHM_ADMIN_URL or settings.SHM_BASE_URL).rstrip("/")
    shm_session: Optional[str] = None
    get_params: dict = {"initData": initData}
    post_body: dict = {"initData": initData}
    if partner_id:
        get_params["partner_id"] = partner_id
        post_body["partner_id"] = partner_id
    try:
        headers = {"Authorization": shm_basic_auth_header(), **_proxy_headers()}
        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            resp = await client.get(
                f"{admin_url}/shm/v1/telegram/webapp/auth",
                params=get_params,
                headers=headers,
            )
            if resp.status_code not in (200, 201):
                resp = await client.post(
                    f"{admin_url}/shm/v1/telegram/webapp/auth",
                    json=post_body,
                    headers=headers,
                )
        logging.info("WebApp SHM → %s: %s", resp.status_code, resp.text[:200])
        if resp.status_code in (200, 201):
            shm_session = resp.json().get("session_id")
    except Exception as exc:
        logging.warning("WebApp SHM error: %s", exc)

    # 3. Fallback: find-or-create через admin API.
    if not shm_session:
        logging.info("WebApp: SHM endpoint не вернул session, fallback")
        user_json_str = params.get("user", "{}")
        try:
            tg_user = json.loads(user_json_str)
        except Exception:
            raise HTTPException(status_code=401, detail="Невалидный user в initData")

        tg_id = tg_user.get("id")
        if not tg_id:
            raise HTTPException(status_code=401, detail="Нет user.id в initData")

        display_name = (
            f"{tg_user.get('first_name', '')} {tg_user.get('last_name', '')}".strip()
            or tg_user.get("username")
            or f"@{tg_id}"
        )
        shm_session = await ensure_telegram_user_session(
            tg_id=tg_id,
            display_name=display_name,
            partner_id=partner_id,
        )

    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = (user_data.get("data") or [{}])[0]
    logging.info("WebApp auth: успех user_id=%s", user.get("user_id"))
    token = create_token(shm_session, user.get("user_id", 0))
    return {"token": token, "user": user}


@router.post("/api/auth/register", response_model=AuthResponse)
@limiter.limit("5/minute")
async def register(request: Request, req: RegisterRequest):
    """Регистрация: email — единственный идентификатор и логин пользователя.

    Предпочитаем публичную SHM-регистрацию (PUT /shm/v1/user) с проксированием
    капча-cookie — так SHM сам валидирует капчу. Если публичный endpoint
    недоступен, используем admin-API как fallback (без валидации капчи).

    После создания аккаунта email автоматически привязывается и высылается
    письмо с кодом подтверждения (фронт показывает шаг верификации).
    """
    email = (req.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email обязателен")
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Некорректный email")

    login_val = (req.login or "").strip().lower() or email
    display_name = req.name or email

    # Капча: декодируем stateless-токен, чтобы достать SHM cookie.
    captcha_cookie = ""
    if req.captcha_token:
        decoded = unpack_captcha_token(req.captcha_token)
        if decoded is None:
            raise HTTPException(status_code=400, detail="Срок действия капчи истёк. Обновите изображение.")
        captcha_cookie = decoded.get("cookie", "")
    captcha_code = (req.captcha_code or "").strip() or None

    # 1. Пробуем публичный endpoint (SHM валидирует капчу сам)
    shm_session: Optional[str] = None
    try:
        shm_session = await shm_public_register(login_val, req.password, display_name, email,
                                                captcha_cookie, captcha_code,
                                                partner_id=req.partner_id)
    except HTTPException:
        raise

    # 2. Fallback: admin API (если публичный endpoint недоступен/не вернул session)
    if not shm_session:
        admin_session = await get_admin_session()

        try:
            existing = await shm_request("GET", "/shm/v1/admin/user", admin_session, params={"login": login_val})
            if existing.get("data"):
                raise HTTPException(status_code=400, detail="Пользователь с таким email уже зарегистрирован")
        except HTTPException as e:
            if e.status_code == 400 and "уже зарегистрирован" in str(e.detail):
                raise

        try:
            create_payload: dict = {
                "login":    login_val,
                "password": req.password,
                "name":     display_name,
                "email":    email,
            }
            if req.partner_id:
                create_payload["partner_id"] = req.partner_id
            await shm_request("PUT", "/shm/v1/admin/user", admin_session, json_data=create_payload)
        except HTTPException as e:
            logging.error("register: SHM create user error %s: %s", e.status_code, e.detail)
            raise HTTPException(status_code=400, detail=f"Не удалось создать аккаунт: {e.detail}")

    # 3. Авторизуемся свежим паролем, если SHM ещё не отдал session_id
    if not shm_session:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
                json={"login": login_val, "password": req.password},
                headers=_proxy_headers(),
            )
        if resp.status_code != 200:
            logging.error("register: SHM login after create failed: %s %s", resp.status_code, resp.text)
            raise HTTPException(status_code=500, detail="Аккаунт создан, но не удалось войти. Попробуйте войти вручную.")
        shm_session = resp.json().get("session_id")

    # 4. Привязываем email (на случай если регистрация не сохранила его) + шлём письмо
    email_verification_sent = False
    try:
        await shm_request(
            "PUT", "/shm/v1/user/email", shm_session,
            json_data={"email": email},
        )
    except HTTPException as exc:
        logging.warning("register: bind email failed: %s", exc.detail)

    try:
        await shm_request(
            "POST", "/shm/v1/user/email", shm_session,
            json_data={"email": email},
        )
        email_verification_sent = True
    except HTTPException as exc:
        logging.warning("register: email verification send failed: %s", exc.detail)

    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = user_data.get("data", [{}])[0] if user_data.get("data") else {}
    user_id = user.get("user_id", 0)

    token = create_token(shm_session, user_id)
    return {
        "token": token,
        "user": user,
        "email_verification_sent": email_verification_sent,
    }
