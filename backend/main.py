"""
SHM Cabinet - FastAPI Backend Proxy
Авторизация: Telegram OAuth + логин/пароль
Проксирует запросы к SHM API, хранит session_id в JWT
"""

import hashlib
import hmac
import json
import time
import io
import base64
import logging
from typing import Optional, List

import httpx
import segno
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

class ChangeServiceRequest(BaseModel):
    user_service_id: int
    service_id: int

class StopServiceRequest(BaseModel):
    user_service_id: int

class PromoCodeRequest(BaseModel):
    code: str

class DeleteServiceRequest(BaseModel):
    user_service_id: int

class BuyServiceResponse(BaseModel):
    success: bool = True
    needs_topup: bool = False
    amount_needed: float = 0.0
    balance: float = 0.0
    message: str = ""


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
    model_config = {"extra": "ignore"}
    name: str
    shm_url: str
    paysystem: Optional[str] = None
    recurring: Optional[int] = None
    allow_deletion: Optional[int] = None
    internal: Optional[int] = None
    weight: Optional[int] = None


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
    import json as _json, logging
    info = svc.get("service") or {}
    # SHM хранит доп. данные (Marzban subscriptionUrl и т.д.) в поле data,
    # которое может быть как dict, так и JSON-строкой
    raw_data = svc.get("data") or {}
    if isinstance(raw_data, str):
        try:
            data = _json.loads(raw_data)
        except Exception:
            data = {}
    else:
        data = raw_data

    logging.debug("normalize_user_service svc keys=%s data=%s", list(svc.keys()), data)

    # Subscription URL: SHM Marzban module stores it in multiple places
    sub_url = (
        svc.get("subscription_url")
        or svc.get("subscriptionUrl")
        or data.get("subscription_url")
        or data.get("subscriptionUrl")
        or (info.get("data") or {}).get("subscriptionUrl") if isinstance(info.get("data"), dict) else None
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
    """Верификация данных от Telegram Login Widget.
    Все поля кроме hash включаются в строку проверки (Telegram docs).
    """
    bot_token = settings.TELEGRAM_BOT_TOKEN
    if not bot_token:
        logging.error("TG auth: TELEGRAM_BOT_TOKEN не задан в .env!")
        return False

    # Собираем все присланные поля (кроме hash) в порядке алфавита
    fields: dict[str, str] = {"auth_date": str(data.auth_date), "id": str(data.id)}
    if data.first_name:  fields["first_name"]  = data.first_name
    if data.last_name:   fields["last_name"]   = data.last_name
    if data.username:    fields["username"]     = data.username
    if data.photo_url:   fields["photo_url"]   = data.photo_url

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    age = time.time() - data.auth_date
    logging.info(
        "TG verify: id=%s fields=%s age=%.0fs expected=%s...  got=%s...",
        data.id, list(fields.keys()), age, expected_hash[:8], data.hash[:8]
    )

    if age > 86400:
        logging.warning("TG auth: auth_date устарел на %.0f сек", age)
        return False

    ok = hmac.compare_digest(expected_hash, data.hash)
    if not ok:
        logging.warning("TG auth: хэш не совпал для id=%s", data.id)
    return ok


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
    logging.info("TG auth request: id=%s username=%s first=%s has_photo=%s",
                 req.id, req.username, req.first_name, bool(req.photo_url))

    if not verify_telegram_auth(req):
        raise HTTPException(status_code=401, detail="Невалидные данные Telegram")

    tg_login = f"@{req.id}"
    logging.info("TG auth: хэш ОК, ищем пользователя %s в SHM", tg_login)

    # Авторизуемся как admin для поиска/создания пользователя
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": settings.SHM_ADMIN_LOGIN, "password": settings.SHM_ADMIN_PASSWORD},
        )
    if resp.status_code != 200:
        logging.error("TG auth: admin SHM login failed: %s %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=500, detail="Ошибка подключения к SHM")

    admin_session = resp.json().get("session_id")
    logging.info("TG auth: admin session получен")

    # Ищем пользователя по login
    users_data = await shm_request(
        "GET", "/shm/v1/admin/user", admin_session, params={"login": tg_login}
    )
    users = users_data.get("data", [])
    logging.info("TG auth: поиск %s → найдено %d пользователей", tg_login, len(users))

    tg_password = str(req.id) + settings.JWT_SECRET[:8]

    if not users:
        # Регистрируем нового пользователя
        new_user_data = {
            "login": tg_login,
            "password": tg_password,
            "name": f"{req.first_name or ''} {req.last_name or ''}".strip() or req.username or tg_login,
        }
        create_result = await shm_request("PUT", "/shm/v1/admin/user", admin_session, json_data=new_user_data)
        logging.info("TG auth: создан новый пользователь: %s", create_result)
    else:
        # Пользователь уже существует — обновляем пароль через admin API,
        # чтобы он всегда совпадал с нашим производным паролем
        existing_user_id = users[0].get("user_id")
        try:
            await shm_request(
                "POST", "/shm/v1/admin/user", admin_session,
                json_data={"user_id": existing_user_id, "password": tg_password},
            )
            logging.info("TG auth: пароль обновлён для user_id=%s", existing_user_id)
        except Exception as e:
            logging.warning("TG auth: не удалось обновить пароль: %s", e)

    # Авторизуемся как пользователь
    async with httpx.AsyncClient(timeout=10.0) as client:
        auth_resp = await client.post(
            f"{settings.SHM_BASE_URL}/shm/user/auth.cgi",
            json={"login": tg_login, "password": tg_password},
        )

    logging.info("TG auth: user SHM login → %s", auth_resp.status_code)
    if auth_resp.status_code != 200:
        logging.error("TG auth: user SHM login failed: %s", auth_resp.text[:200])
        raise HTTPException(status_code=401, detail="Ошибка авторизации TG пользователя")

    shm_session = auth_resp.json().get("session_id")
    user_data = await shm_request("GET", "/shm/v1/user", shm_session)
    user = user_data.get("data", [{}])[0] if user_data.get("data") else {}
    user_id = user.get("user_id", 0)

    logging.info("TG auth: успех, user_id=%s", user_id)
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
    import asyncio
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    services = [normalize_user_service(s) for s in raw_list]

    # Для услуг без subscription_url — подтягиваем из Marzban-хранилища
    missing_idx = [i for i, s in enumerate(services) if not s.get("subscription_url") and s.get("id")]
    if missing_idx:
        try:
            urls = await asyncio.gather(
                *[_fetch_sub_url_from_storage(services[i]["id"], session.get("user_id", 0)) for i in missing_idx],
                return_exceptions=True,
            )
            for i, url in zip(missing_idx, urls):
                if isinstance(url, str) and url:
                    services[i]["subscription_url"] = url
        except Exception:
            pass

    return services


@app.get("/api/user/payments", response_model=list[PaymentOut])
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
    data = result.get("data", result) if isinstance(result, dict) else {}
    if isinstance(data, list):
        data = data[0] if data else {}
    return normalize_user_service(data)


@app.post("/api/user/service/stop")
async def stop_service(req: StopServiceRequest, session: dict = Depends(get_current_session)):
    """Остановить услугу: POST /shm/v1/user/service/stop"""
    return await shm_request(
        "POST", "/shm/v1/user/service/stop", session["shm_session"],
        json_data={"user_service_id": req.user_service_id},
    )


@app.delete("/api/user/service")
async def delete_service(req: DeleteServiceRequest, session: dict = Depends(get_current_session)):
    """Удалить услугу: сначала останавливаем (если активна), затем удаляем"""
    try:
        await shm_request(
            "POST", "/shm/v1/user/service/stop", session["shm_session"],
            json_data={"user_service_id": req.user_service_id},
        )
    except HTTPException:
        pass  # уже остановлена или заблокирована — продолжаем
    return await shm_request(
        "DELETE", "/shm/v1/user/service", session["shm_session"],
        json_data={"user_service_id": req.user_service_id},
    )


@app.get("/api/user/service/orders")
async def get_service_orders(session: dict = Depends(get_current_session)):
    """История заказов услуг пользователя: GET /shm/v1/service/order"""
    data = await shm_request(
        "GET", "/shm/v1/service/order", session["shm_session"],
        params={"limit": 100, "offset": 0},
    )
    return data.get("data", [])


@app.post("/api/user/promo")
async def apply_promo(req: PromoCodeRequest, session: dict = Depends(get_current_session)):
    """Применить промокод"""
    result = await shm_request(
        "POST", "/shm/v1/user/promo", session["shm_session"],
        json_data={"code": req.code},
    )
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg", "Промокод не найден или уже использован"))
    return result


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


@app.post("/api/services/buy", response_model=BuyServiceResponse)
async def buy_service(req: BuyServiceRequest, session: dict = Depends(get_current_session)):
    import logging, asyncio
    result = await shm_request(
        "PUT", "/shm/v1/service/order", session["shm_session"],
        json_data={"service_id": req.service_id},
    )
    logging.info("buy_service response: %s", result)
    # SHM может вернуть {"status": 4xx, "msg": "..."} c HTTP 200
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg", "Ошибка при покупке услуги"))

    # Extract first ordered service
    order_list = result.get("data", []) if isinstance(result, dict) else []
    svc_raw = order_list[0] if order_list else {}
    svc_status = str(svc_raw.get("status", "")).upper()

    # If service is not yet active, check whether balance is insufficient
    if svc_status in ("PROGRESS", "INIT", "NOT PAID"):
        try:
            admin_session = await get_admin_session()
            user_data, catalog_data = await asyncio.gather(
                shm_request("GET", "/shm/v1/user", session["shm_session"]),
                shm_request("GET", "/shm/v1/admin/service", admin_session),
            )
            user_info = (user_data.get("data") or [{}])[0]
            balance = float(user_info.get("balance") or 0)

            cost = 0.0
            for s in catalog_data.get("data", []):
                sid = s.get("id") or s.get("service_id")
                if sid == req.service_id:
                    cost = float(s.get("cost") or 0)
                    break

            amount_needed = round(max(0.0, cost - balance), 2)
            if amount_needed > 0:
                return BuyServiceResponse(
                    success=True,
                    needs_topup=True,
                    amount_needed=amount_needed,
                    balance=round(balance, 2),
                    message=f"Услуга зарегистрирована. Пополните баланс на {amount_needed:.2f} ₽ для активации",
                )
        except Exception:
            pass  # balance check is best-effort; don't fail the whole request

    return BuyServiceResponse(success=True, message="Услуга успешно подключена")


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
# VPN Setup: /api/vpn/setup
# ---------------------------------------------------------------------------

async def _fetch_sub_url_from_storage(user_service_id: int, user_id: int = 0) -> Optional[str]:
    """Берёт subscriptionUrl из SHM Marzban-хранилища.
    Эндпоинт: GET /shm/v1/storage/manage/vpn_mrzb_{id}?user_id={user_id}
    Требует admin session + user_id для доступа к хранилищу конкретного пользователя.
    Ответ: text/plain → JSON.
    """
    url = f"{settings.SHM_BASE_URL}/shm/v1/storage/manage/vpn_mrzb_{user_service_id}"
    try:
        admin_session = await get_admin_session()
        params = {"user_id": user_id} if user_id else {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                headers={
                    "session-id": admin_session,
                    "Accept": "text/plain, application/json",
                },
                params=params,
            )
        if resp.status_code != 200:
            return None
        text = resp.text.strip()
        if not text:
            return None
        data = json.loads(text)
        return data.get("subscriptionUrl") or data.get("subscription_url")
    except Exception as e:
        logging.warning("_fetch_sub_url_from_storage(%s) error: %s", user_service_id, e)
    return None


_HAPP_DOWNLOADS = {
    "ios":     "https://apps.apple.com/app/happ/id6744897585",
    "android": "https://play.google.com/store/apps/details?id=com.happ.vpn",
    "windows": "https://github.com/hiddify/hiddify-app/releases/latest",
    "macos":   "https://apps.apple.com/app/happ/id6744897585",
}


def _detect_platform(ua: str) -> str:
    ua = ua.lower()
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return "ios"
    if "android" in ua:
        return "android"
    if "mac" in ua:
        return "macos"
    return "windows"


def _build_deeplink(subscription_url: str) -> str:
    return f"happ://add/{subscription_url}"


def _generate_qr_base64(data: str) -> str:
    """QR code → PNG data-URI (base64)."""
    qr = segno.make(data)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=8, dark="#000000", light="#ffffff")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


class VpnSetupResponse(BaseModel):
    platform: str
    subscription_url: str
    step1: dict    # скачать
    step2: dict    # подключиться
    fallback: dict  # ручная настройка


@app.get("/api/user/service/{service_id}/config")
async def vpn_setup_by_service(
    service_id: int,
    request: Request,
    platform: Optional[str] = None,
    session: dict = Depends(get_current_session),
):
    """Конфигурация VPN-клиента для услуги пользователя."""
    # 1. Ищем subscription_url в данных SHM user/service
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    sub_url = None
    for svc in raw_list:
        if str(svc.get("user_service_id", "")) == str(service_id):
            ns = normalize_user_service(svc)
            sub_url = ns.get("subscription_url")
            break

    # 2. Запрашиваем Marzban-хранилище (admin session + user_id)
    if not sub_url:
        sub_url = await _fetch_sub_url_from_storage(service_id, session.get("user_id", 0))

    if not sub_url:
        raise HTTPException(
            status_code=404,
            detail=f"Ссылка подписки не найдена для услуги {service_id}. Проверьте логи сервера."
        )

    return _build_setup_response(sub_url, request, platform)


@app.get("/api/vpn/setup")
async def vpn_setup_by_url(
    url: str,
    request: Request,
    platform: Optional[str] = None,
    session: dict = Depends(get_current_session),
):
    """Конфигурация VPN-клиента по прямой ссылке подписки."""
    if not url:
        raise HTTPException(status_code=400, detail="URL подписки не указан")
    return _build_setup_response(url, request, platform)


def _build_setup_response(sub_url: str, request: Request, platform: Optional[str]) -> dict:
    # Платформа
    detected = platform or _detect_platform(request.headers.get("user-agent", ""))

    # Deep link
    deeplink = _build_deeplink(sub_url)

    # QR code
    qr_data = _generate_qr_base64(deeplink)

    return {
        "platform": detected,
        "subscription_url": sub_url,
        "step1": {
            "title": "Скачайте приложение",
            "app_name": "Happ",
            "download_url": _HAPP_DOWNLOADS.get(detected, _HAPP_DOWNLOADS["windows"]),
            "all_downloads": _HAPP_DOWNLOADS,
        },
        "step2": {
            "title": "Подключиться",
            "deeplink": deeplink,
            "copy_link": sub_url,
            "qr_code": qr_data,
        },
        "fallback": {
            "title": "Ручная настройка",
            "instruction": (
                "1. Откройте приложение Happ\n"
                "2. Нажмите «+» → «Добавить подписку»\n"
                "3. Вставьте скопированную ссылку"
            ),
            "copy_link": sub_url,
        },
    }


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
