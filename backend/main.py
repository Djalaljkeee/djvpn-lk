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

class ChangeServiceRequest(BaseModel):
    user_service_id: int
    service_id: int

class StopServiceRequest(BaseModel):
    user_service_id: int

class DeleteServiceRequest(BaseModel):
    user_service_id: int


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

def normalize_payment(pay: dict) -> dict:
    return {
        "id":              pay.get("id"),
        "amount":          float(pay.get("money") or 0),  # SHM: money, not amount
        "pay_system_id":   pay.get("pay_system_id"),
        "pay_system_name": pay.get("pay_system_id"),
        "created":         pay.get("date"),               # SHM: date, not created
        "status":          1,
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
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
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


@app.post("/api/auth/telegram")
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


# ---------------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------------

@app.get("/api/user/profile")
async def get_profile(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user", session["shm_session"])
    return (data.get("data") or [{}])[0]


@app.get("/api/user/services")
async def get_user_services(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    return [normalize_user_service(s) for s in data.get("data", [])]


@app.get("/api/user/payments")
async def get_payments(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/pay", session["shm_session"])
    return [normalize_payment(p) for p in data.get("data", [])]


@app.get("/api/user/referrals")
async def get_referrals(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/partner", session["shm_session"])
    return data.get("data", [])


@app.post("/api/user/service/change", response_model=UserServiceOut)
async def change_service(req: ChangeServiceRequest, session: dict = Depends(get_current_session)):
    """Сменить тариф: POST /shm/v1/user/service/change"""
    result = await shm_request(
        "POST", "/shm/v1/user/service/change", session["shm_session"],
        json_data={"user_service_id": req.user_service_id, "service_id": req.service_id},
    )
    return normalize_user_service(result.get("data", result) if isinstance(result, dict) else {})


@app.post("/api/user/service/stop")
async def stop_service(req: StopServiceRequest, session: dict = Depends(get_current_session)):
    """Остановить услугу: POST /shm/v1/user/service/stop"""
    return await shm_request(
        "POST", "/shm/v1/user/service/stop", session["shm_session"],
        json_data={"user_service_id": req.user_service_id},
    )


@app.delete("/api/user/service")
async def delete_service(req: DeleteServiceRequest, session: dict = Depends(get_current_session)):
    """Удалить услугу: DELETE /shm/v1/user/service"""
    return await shm_request(
        "DELETE", "/shm/v1/user/service", session["shm_session"],
        json_data={"user_service_id": req.user_service_id},
    )


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

@app.get("/api/services")
async def get_services(session: dict = Depends(get_current_session)):
    try:
        admin_session = await get_admin_session()
        data = await shm_request("GET", "/shm/v1/admin/service", admin_session)
        return [normalize_catalog_service(s) for s in data.get("data", [])]
    except HTTPException:
        return []


@app.post("/api/services/buy")
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

@app.get("/api/pay-systems")
async def get_pay_systems(session: dict = Depends(get_current_session)):
    try:
        data = await shm_request("GET", "/shm/v1/admin/pay_system", session["shm_session"])
        return data.get("data", [])
    except HTTPException:
        return []


@app.get("/api/pay/webapp-url")
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
