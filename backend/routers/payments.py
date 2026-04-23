"""Payments: history, pay systems, create payment, forecast."""

from fastapi import APIRouter, Depends, HTTPException

from config import settings
from models import (
    ForecastResponse,
    PaymentOut,
    PaymentRequest,
    PaySystemOut,
    PaySystemV2Out,
    WebappUrlResponse,
)
from normalizers import normalize_payment
from security import get_current_session
from shm_client import shm_request


router = APIRouter()


@router.get("/api/user/payments", response_model=list[PaymentOut])
async def get_payments(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/pay", session["shm_session"])
    return [normalize_payment(p) for p in data.get("data", [])]


@router.get("/api/pay-systems", response_model=list[PaySystemOut])
async def get_pay_systems(session: dict = Depends(get_current_session)):
    try:
        data = await shm_request("GET", "/shm/v1/admin/pay_system", session["shm_session"])
        return data.get("data", [])
    except HTTPException:
        return []


@router.get("/api/pay/paysystems", response_model=list[PaySystemV2Out])
async def get_paysystems_v2(session: dict = Depends(get_current_session)):
    """Платёжные системы с прямыми ссылками (из SHM tg_payment_webapp)."""
    try:
        data = await shm_request("GET", "/shm/v1/user/pay/paysystems", session["shm_session"])
        return data.get("data", [])
    except HTTPException:
        return []


@router.get("/api/pay/webapp-url", response_model=WebappUrlResponse)
async def get_payment_webapp_url(session: dict = Depends(get_current_session)):
    """URL страницы оплаты SHM (Telegram Payment WebApp)."""
    public_url = (settings.SHM_PUBLIC_URL or "").rstrip("/")
    if not public_url:
        raise HTTPException(status_code=503, detail="SHM_PUBLIC_URL не настроен")
    user_id = session.get("user_id", 0)
    return {"url": f"{public_url}/shm/v1/public/tg_payment_webapp?format=html&user_id={user_id}"}


@router.post("/api/pay/create")
async def create_payment(req: PaymentRequest, session: dict = Depends(get_current_session)):
    return await shm_request(
        "PUT", "/shm/v1/user/payment", session["shm_session"],
        json_data={"pay_system_id": req.pay_system_id, "amount": req.amount},
    )


@router.get("/api/user/pay/forecast", response_model=ForecastResponse)
async def get_pay_forecast(session: dict = Depends(get_current_session)):
    """Payment forecast: proxies GET /shm/v1/user/pay/forecast."""
    data = await shm_request(
        "GET", "/shm/v1/user/pay/forecast", session["shm_session"],
        params={"limit": 25, "offset": 0},
    )
    return data
