"""User profile, email, referrals."""

import asyncio
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from models import (
    EMAIL_RE,
    ChangePasswordRequest,
    EmailVerifyRequest,
    EmailVerifyResponse,
    ReferralSummaryOut,
    UpdateEmailRequest,
    UserProfile,
)
from security import get_current_session
from shm_client import shm_request


router = APIRouter()


def _coerce_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y", "on", "t")
    return False


_EMAIL_VERIFIED_KEYS = (
    "email_verified",
    "email_verify",
    "email_confirmed",
    "is_email_verified",
    "email_is_verified",
    "verified_email",
    "email_status",
)


@router.get("/api/user/profile", response_model=UserProfile)
async def get_profile(session: dict = Depends(get_current_session)):
    results = await asyncio.gather(
        shm_request("GET", "/shm/v1/user", session["shm_session"]),
        shm_request("GET", "/shm/v1/user/email", session["shm_session"]),
        return_exceptions=True,
    )
    data = results[0] if not isinstance(results[0], Exception) else {}
    email_data = results[1] if not isinstance(results[1], Exception) else {}

    user = dict((data.get("data") or [{}])[0])

    # Merge email + verified status from the dedicated email endpoint.
    if isinstance(email_data, dict):
        email_row = (email_data.get("data") or [{}])[0]
        if email_row.get("email"):
            user["email"] = email_row["email"]
            user.setdefault("email_verified", _coerce_bool(email_row.get("email_verified")))

    # SHM may return email verification flag under several names — normalize.
    raw = next(
        (user[k] for k in _EMAIL_VERIFIED_KEYS if k in user and user[k] is not None),
        None,
    )
    user["email_verified"] = _coerce_bool(raw) if raw is not None else False

    return user


@router.put("/api/user/email")
async def update_email(req: UpdateEmailRequest, session: dict = Depends(get_current_session)):
    """Привязать/изменить email пользователя: PUT /shm/v1/user/email.
    После сохранения автоматически инициирует отправку письма с кодом подтверждения.
    """
    email = (req.email or "").strip()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Некорректный email")

    result = await shm_request(
        "PUT", "/shm/v1/user/email", session["shm_session"],
        json_data={"email": email},
    )
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        msg = result.get("msg") or "Не удалось сохранить email"
        raise HTTPException(status_code=400, detail=msg)

    # Запрашиваем отправку письма с кодом подтверждения — best effort,
    # чтобы не ломать основной ответ в случае ошибок SHM.
    verification_sent = False
    try:
        await shm_request(
            "POST", "/shm/v1/user/email", session["shm_session"],
            json_data={"email": email},
        )
        verification_sent = True
    except HTTPException as exc:
        logging.warning("update_email: email send failed: %s", exc.detail)

    return {"ok": True, "email": email, "verification_sent": verification_sent}


@router.post("/api/user/email/request-verify")
async def request_email_verify(session: dict = Depends(get_current_session)):
    """Отправить повторно письмо с кодом подтверждения email."""
    email_data = await shm_request("GET", "/shm/v1/user/email", session["shm_session"])
    email_row = (email_data.get("data") or [{}])[0]
    email = (email_row.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Email не привязан")

    try:
        result = await shm_request(
            "POST", "/shm/v1/user/email", session["shm_session"],
            json_data={"email": email},
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        raise HTTPException(status_code=400, detail=detail or "Не удалось отправить письмо")

    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg") or "Не удалось отправить письмо")

    return {"ok": True, "email": email, "message": "Письмо с кодом подтверждения отправлено"}


@router.post("/api/user/email/verify", response_model=EmailVerifyResponse)
async def verify_email(req: EmailVerifyRequest, session: dict = Depends(get_current_session)):
    """Подтвердить email кодом из письма: POST /shm/v1/user/email/verify."""
    token = (req.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Введите код из письма")

    try:
        result = await shm_request(
            "POST", "/shm/v1/user/email/verify", session["shm_session"],
            json_data={"token": token},
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        raise HTTPException(status_code=400, detail=detail or "Неверный код подтверждения")

    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg") or "Неверный код подтверждения")

    return EmailVerifyResponse(ok=True, verified=True, message="Email подтверждён")


@router.post("/api/user/passwd")
async def change_password(req: ChangePasswordRequest, session: dict = Depends(get_current_session)):
    """Сменить пароль пользователя: POST /shm/v1/user/passwd."""
    password = (req.password or "").strip()
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть не менее 6 символов")
    result = await shm_request(
        "POST", "/shm/v1/user/passwd", session["shm_session"],
        json_data={"password": password},
    )
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg") or "Не удалось сменить пароль")
    return {"ok": True}


@router.get("/api/user/referrals", response_model=ReferralSummaryOut)
async def get_referrals(session: dict = Depends(get_current_session)):
    data = await shm_request(
        "GET", "/shm/v1/user/referrals", session["shm_session"],
        params={"limit": 25, "offset": 0},
    )
    raw_items = data.get("data", []) if isinstance(data, dict) else []

    total_referrals = 0
    total_income = 0.0
    referrals: List[dict] = []

    for item in raw_items:
        if not isinstance(item, dict):
            continue
        if "total" in item and item.get("total") is not None:
            try:
                total_referrals = int(item.get("total", 0))
            except Exception:
                total_referrals = 0
            continue

        try:
            income = float(item.get("income", 0) or 0)
        except Exception:
            income = 0.0

        total_income += income
        referrals.append({
            "user_id": item.get("user_id"),
            "login": item.get("login"),
            "name": item.get("name"),
            "created": item.get("created"),
            "income": income,
        })

    if not total_referrals:
        total_referrals = len(referrals)

    return {
        "total_referrals": total_referrals,
        "total_income": total_income,
        "items": len(referrals),
        "referrals": referrals or None,
    }
