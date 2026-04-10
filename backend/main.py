"""
SHM Cabinet - FastAPI Backend Proxy
Авторизация: Telegram OAuth + логин/пароль
Проксирует запросы к SHM API, хранит session_id в JWT
"""

import hashlib
import hmac
import json
import time
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from jose import jwt, JWTError
from pydantic import BaseModel

from config import settings

app = FastAPI(title="SHM Cabinet API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    login: str
    password: str

class RegisterRequest(BaseModel):
    login: str
    password: str
    name: Optional[str] = None

class TelegramAuthRequest(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str

class PaymentRequest(BaseModel):
    pay_system_id: int
    amount: float

class BuyServiceRequest(BaseModel):
    service_id: int


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class UserProfile(BaseModel):
    user_id: int
    login: str
    name: Optional[str] = None
    balance: float = 0
    credit: float = 0
    status: int = 1
    created: Optional[str] = None

class UserServiceOut(BaseModel):
    id: Optional[int] = None
    service_id: Optional[int] = None
    name: str = ""
    status: int = 0
    created: Optional[str] = None
    expired: Optional[str] = None
    cost: Optional[float] = None
    period: Optional[int] = None
    period_type: str = "month"
    descr: Optional[str] = None
    subscription_url: Optional[str] = None

class PaymentOut(BaseModel):
    id: Optional[int] = None
    amount: float = 0
    pay_system_id: Optional[str] = None   # SHM: строка, напр. 'yookassa'
    pay_system_name: Optional[str] = None
    created: Optional[str] = None
    status: int = 1
    comment: Optional[str] = None

class CatalogServiceOut(BaseModel):
    service_id: Optional[int] = None
    name: str = ""
    cost: float = 0
    period: int = 1
    period_type: str = "month"
    descr: Optional[str] = None
    category: Optional[str] = None
    status: int = 1

class PaySystemOut(BaseModel):
    pay_system_id: int
    name: str
    currency: Optional[str] = None
    min_amount: Optional[float] = None
    commission: Optional[float] = None

class AuthResponse(BaseModel):
    token: str
    user: UserProfile

class WebappUrlResponse(BaseModel):
    url: str

class PublicConfig(BaseModel):
    telegram_bot_username: str

class PaySystemV2Out(BaseModel):
    name: str
    shm_url: str
    amount: Optional[float] = None
    recurring: Optional[str] = None
    pay_system: Optional[int] = None


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_token(shm_session_id: str, user_id: int) -> str:
    payload = {
        "shm_session": shm_session_id,
        "user_id": user_id,
        "exp": time.time() + settings.JWT_EXPIRE_SECONDS,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

def get_current_session(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    return decode_token(credentials.credentials)


# ---------------------------------------------------------------------------
# SHM field normalization
# ---------------------------------------------------------------------------

_SERVICE_STATUS = {
    "ACTIVE": 1, "BLOCK": 2, "NOT PAID": 2,
    "STUCK": 2, "REMOVED": 3, "INIT": 0, "PROGRESS": 0,
}

def normalize_user_service(svc: dict) -> dict:
    info = svc.get("service") or {}
    data = svc.get("data") or {}
    # Subscription URL: SHM Marzban module stores it in multiple places
    sub_url = (
        svc.get("subscription_url")
        or svc.get("subscriptionUrl")
        or data.get("subscription_url")
        or data.get("subscriptionUrl")
    )
    return {
        "id":               svc.get("user_service_id"),
        "service_id":       svc.get("service_id"),
        "name":             info.get("name") or svc.get("name", ""),
        "status":           _SERVICE_STATUS.get(str(svc.get("status", "")), 0),
        "created":          svc.get("created"),
        "expired":          svc.get("expire"),          # SHM: expire, not expired
        "cost":             info.get("cost") or svc.get("cost"),
        "period":           svc.get("period") or svc.get("period_cost"),
        "period_type":      svc.get("period_type", "month"),
        "descr":            info.get("descr") or svc.get("descr"),
        "subscription_url": sub_url,
    }

_PAY_SYSTEM_NAMES: dict[str, str] = {
    "yookassa":          "ЮKassa",
    "yookassa-canceled": "Отменён (ЮKassa)",
    "yookassa-refund":   "Возврат (ЮKassa)",
}

def normalize_payment(pay: dict) -> dict:
    return {
        "id":              pay.get("id"),
        "amount":          float(pay.get("money") or 0),  # SHM: money, not amount
        "pay_system_id":   str(pay.get("pay_system_id") or ""),
        "pay_system_name": _PAY_SYSTEM_NAMES.get(str(pay.get("pay_system_id") or ""), str(pay.get("pay_system_id") or "")),
        "created":         pay.get("date"),               # SHM: date, not created
        "status":          1 if str(pay.get("pay_system_id") or "").find("canceled") < 0 and str(pay.get("pay_system_id") or "").find("refund") < 0 else 0,
        "comment":         pay.get("comment"),
    }

def normalize_catalog_service(svc: dict) -> dict:
    allow = svc.get("allow_to_order", 1)
    return {
        "service_id":  svc.get("id") or svc.get("service_id"),
        "name":        svc.get("name", ""),
        "cost":        float(svc.get("cost") or 0),
        "period":      int(svc.get("period_cost") or svc.get("period") or 1),
        "period_type": svc.get("period_type", "month"),
        "descr":       svc.get("descr"),
        "category":    svc.get("category"),
        "status":      1 if allow else 0,
    }


# ---------------------------------------------------------------------------
# SHM API client
# ---------------------------------------------------------------------------

async def get_admin_session() -> str:
    """Получить admin session_id от SHM"""
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
    import logging
    logging.warning("SHM %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
    raise HTTPException(status_code=resp.status_code, detail=resp.text)


# ---------------------------------------------------------------------------
# Telegram OAuth verification
# ---------------------------------------------------------------------------

def verify_telegram_auth(data: TelegramAuthRequest) -> bool:
    """Верификация данных от Telegram Login Widget"""
    bot_token = settings.TELEGRAM_BOT_TOKEN
    check_hash = data.hash

    data_dict = {
        "auth_date": str(data.auth_date),
        "first_name": data.first_name or "",
        "id": str(data.id),
        "username": data.username or "",
    }
    data_dict = {k: v for k, v in data_dict.items() if v}
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data_dict.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if time.time() - data.auth_date > 86400:
        return False

    return hmac.compare_digest(expected_hash, check_hash)


# ---------------------------------------------------------------------------
# Public config (no auth required)
# ---------------------------------------------------------------------------

@app.get("/api/config", response_model=PublicConfig)
async def get_public_config():
    """Публичная конфигурация для фронтенда"""
    return PublicConfig(telegram_bot_username=settings.TELEGRAM_BOT_USERNAME)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/api/auth/login", response_model=AuthResponse)
async def login(req: LoginRequest):
    """Авторизация по логину и паролю через SHM"""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": req.login, "password": req.password},
            headers={"Content-Type": "application/json"},
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


@app.post("/api/auth/telegram", response_model=AuthResponse)
async def telegram_auth(req: TelegramAuthRequest):
    """Авторизация через Telegram Login Widget"""
    if not verify_telegram_auth(req):
        raise HTTPException(status_code=401, detail="Невалидные данные Telegram")

    tg_login = f"@{req.id}"

    # Авторизуемся как admin для поиска/создания пользователя
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": settings.SHM_ADMIN_LOGIN, "password": settings.SHM_ADMIN_PASSWORD},
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Ошибка подключения к SHM")

    admin_session = resp.json().get("session_id")

    # Ищем пользователя по login
    users_data = await shm_request(
        "GET", "/shm/v1/admin/user", admin_session, params={"login": tg_login}
    )
    users = users_data.get("data", [])

    tg_password = str(req.id) + settings.JWT_SECRET[:8]

    if not users:
        # Регистрируем нового пользователя
        new_user_data = {
            "login": tg_login,
            "password": tg_password,
            "name": f"{req.first_name or ''} {req.last_name or ''}".strip() or req.username or tg_login,
        }
        await shm_request("PUT", "/shm/v1/admin/user", admin_session, json_data=new_user_data)

    # Авторизуемся как пользователь
    async with httpx.AsyncClient(timeout=10.0) as client:
        auth_resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": tg_login, "password": tg_password},
        )

    if auth_resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Ошибка авторизации TG пользователя")

    shm_session = auth_resp.json().get("session_id")
    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = user_data.get("data", [{}])[0] if user_data.get("data") else {}
    user_id = user.get("user_id", 0)

    token = create_token(shm_session, user_id)
    return {"token": token, "user": user}


@app.post("/api/auth/register", response_model=AuthResponse)
async def register(req: RegisterRequest):
    """Регистрация нового пользователя через SHM admin API"""
    import logging
    admin_session = await get_admin_session()

    # Проверяем логин — SHM может вернуть 400/404 если не найден, это нормально
    try:
        existing = await shm_request("GET", "/shm/v1/admin/user", admin_session, params={"login": req.login})
        if existing.get("data"):
            raise HTTPException(status_code=400, detail="Пользователь с таким логином уже существует")
    except HTTPException as e:
        if e.status_code == 400 and "уже существует" in str(e.detail):
            raise
        # SHM вернул ошибку при поиске — значит пользователь не найден, продолжаем

    # Создаём пользователя
    try:
        result = await shm_request("PUT", "/shm/v1/admin/user", admin_session, json_data={
            "login":    req.login,
            "password": req.password,
            "name":     req.name or req.login,
        })
        logging.info("register: SHM create user result: %s", result)
    except HTTPException as e:
        logging.error("register: SHM create user error %s: %s", e.status_code, e.detail)
        raise HTTPException(status_code=400, detail=f"Не удалось создать аккаунт: {e.detail}")

    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": req.login, "password": req.password},
        )
    if resp.status_code != 200:
        logging.error("register: SHM login after create failed: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=500, detail="Аккаунт создан, но не удалось войти. Попробуйте войти вручную.")

    shm_session = resp.json().get("session_id")
    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = user_data.get("data", [{}])[0] if user_data.get("data") else {}
    user_id = user.get("user_id", 0)

    token = create_token(shm_session, user_id)
    return {"token": token, "user": user}


# ---------------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------------

@app.get("/api/user/profile", response_model=UserProfile)
async def get_profile(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user", session["shm_session"])
    return (data.get("data") or [{}])[0]


@app.get("/api/user/services", response_model=list[UserServiceOut])
async def get_user_services(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    return [normalize_user_service(s) for s in data.get("data", [])]


@app.get("/api/user/payments", response_model=list[PaymentOut])
async def get_payments(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/pay", session["shm_session"])
    return [normalize_payment(p) for p in data.get("data", [])]


@app.get("/api/user/referrals")
async def get_referrals(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/partner", session["shm_session"])
    return data.get("data", [])


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

@app.get("/api/services", response_model=list[CatalogServiceOut])
async def get_services(session: dict = Depends(get_current_session)):
    try:
        admin_session = await get_admin_session()
        data = await shm_request("GET", "/shm/v1/admin/service", admin_session)
        return [normalize_catalog_service(s) for s in data.get("data", [])]
    except HTTPException:
        return []


@app.post("/api/services/buy", response_model=UserServiceOut)
async def buy_service(req: BuyServiceRequest, session: dict = Depends(get_current_session)):
    import logging
    result = await shm_request(
        "PUT", "/shm/v1/user/service", session["shm_session"],
        json_data={"service_id": req.service_id},
    )
    logging.info("buy_service response: %s", result)
    # SHM может вернуть {"status": 4xx, "msg": "..."} c HTTP 200
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg", "Ошибка при покупке услуги"))
    return result


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

@app.get("/api/pay-systems", response_model=list[PaySystemOut])
async def get_pay_systems(session: dict = Depends(get_current_session)):
    try:
        data = await shm_request("GET", "/shm/v1/admin/pay_system", session["shm_session"])
        return data.get("data", [])
    except HTTPException:
        return []


@app.get("/api/pay/paysystems", response_model=list[PaySystemV2Out])
async def get_paysystems_v2(session: dict = Depends(get_current_session)):
    """Платёжные системы с прямыми ссылками (из SHM tg_payment_webapp)"""
    try:
        data = await shm_request("GET", "/shm/v1/user/pay/paysystems", session["shm_session"])
        return data.get("data", [])
    except HTTPException:
        return []


@app.get("/api/pay/webapp-url", response_model=WebappUrlResponse)
async def get_payment_webapp_url(session: dict = Depends(get_current_session)):
    """URL страницы оплаты SHM (Telegram Payment WebApp)"""
    public_url = (settings.SHM_PUBLIC_URL or "").rstrip("/")
    if not public_url:
        raise HTTPException(status_code=503, detail="SHM_PUBLIC_URL не настроен")
    user_id = session.get("user_id", 0)
    return {"url": f"{public_url}/shm/v1/public/tg_payment_webapp?format=html&user_id={user_id}"}


@app.post("/api/pay/create")
async def create_payment(req: PaymentRequest, session: dict = Depends(get_current_session)):
    result = await shm_request(
        "PUT", "/shm/v1/user/payment", session["shm_session"],
        json_data={"pay_system_id": req.pay_system_id, "amount": req.amount},
    )
    return result


# ---------------------------------------------------------------------------
# Serve static frontend (production)
# ---------------------------------------------------------------------------

import os
if os.path.exists("../frontend/dist"):
    app.mount("/assets", StaticFiles(directory="../frontend/dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        return FileResponse("../frontend/dist/index.html")
