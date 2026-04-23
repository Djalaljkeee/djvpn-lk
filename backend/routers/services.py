"""Service catalog, purchase/change/stop/delete, promo codes."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from models import (
    BuyServiceRequest,
    BuyServiceResponse,
    CatalogServiceOut,
    ChangeServiceRequest,
    ChangeServiceResponse,
    DeleteServiceRequest,
    PromoApplyResponse,
    PromoCodeRequest,
    StopServiceRequest,
    UserServiceOut,
)
from normalizers import is_insufficient_funds_msg, normalize_catalog_service, normalize_user_service
from security import get_current_session
from shm_client import get_admin_session, shm_request
from storage import fetch_sub_url_from_storage


router = APIRouter()


@router.get("/api/user/services", response_model=list[UserServiceOut])
async def get_user_services(session: dict = Depends(get_current_session)):
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    services = [normalize_user_service(s) for s in raw_list]

    # Для услуг без subscription_url — подтягиваем из Marzban-хранилища
    missing_idx = [i for i, s in enumerate(services) if not s.get("subscription_url") and s.get("id")]
    if missing_idx:
        try:
            urls = await asyncio.gather(
                *[fetch_sub_url_from_storage(services[i]["id"], session.get("user_id", 0)) for i in missing_idx],
                return_exceptions=True,
            )
            for i, url in zip(missing_idx, urls):
                if isinstance(url, str) and url:
                    services[i]["subscription_url"] = url
        except Exception:
            pass

    return services


@router.post("/api/user/service/change", response_model=ChangeServiceResponse)
async def change_service(req: ChangeServiceRequest, session: dict = Depends(get_current_session)):
    """Сменить тариф: POST /shm/v1/user/service/change.

    SHM фиксирует смену тарифа даже при нехватке средств — по аналогии с
    /api/services/buy возвращаем needs_topup + недостающую сумму, а не
    бросаем ошибку. Фронт покажет топап-модалку.
    """
    insufficient_funds = False
    try:
        result = await shm_request(
            "POST", "/shm/v1/user/service/change", session["shm_session"],
            json_data={"user_service_id": req.user_service_id, "service_id": req.service_id},
        )
    except HTTPException as exc:
        detail_text = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        if exc.status_code == 402 or is_insufficient_funds_msg(detail_text):
            insufficient_funds = True
            result = {}
        elif 400 <= exc.status_code < 500:
            raise HTTPException(status_code=400, detail=detail_text or "Ошибка смены тарифа")
        else:
            raise HTTPException(status_code=502, detail="SHM недоступен")

    # SHM может вернуть {"status": 4xx, "msg": "..."} с HTTP 200
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        msg = result.get("msg") or "Ошибка смены тарифа"
        if is_insufficient_funds_msg(msg):
            insufficient_funds = True
        else:
            raise HTTPException(status_code=400, detail=msg)

    # Best-effort: посчитать баланс и стоимость нового тарифа.
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
        if amount_needed > 0 or insufficient_funds:
            return ChangeServiceResponse(
                success=True,
                needs_topup=True,
                amount_needed=amount_needed,
                balance=round(balance, 2),
                message=f"Тариф изменён. Для активации пополните баланс на {amount_needed:.2f} ₽",
            )
    except HTTPException:
        pass  # вторичная проверка — не валим основной ответ
    except Exception:
        logging.warning("change_service: balance/catalog check failed", exc_info=True)

    return ChangeServiceResponse(success=True, message="Тариф успешно изменён")


@router.post("/api/user/service/stop")
async def stop_service(req: StopServiceRequest, session: dict = Depends(get_current_session)):
    """Остановить услугу: POST /shm/v1/user/service/stop."""
    return await shm_request(
        "POST", "/shm/v1/user/service/stop", session["shm_session"],
        json_data={"user_service_id": req.user_service_id},
    )


@router.delete("/api/user/service")
async def delete_service(req: DeleteServiceRequest, session: dict = Depends(get_current_session)):
    """Удалить услугу: сначала останавливаем (если активна), затем удаляем."""
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


@router.get("/api/user/service/orders")
async def get_service_orders(session: dict = Depends(get_current_session)):
    """Услуги, доступные к заказу текущим пользователем."""
    data = await shm_request(
        "GET", "/shm/v1/service/order", session["shm_session"],
        params={"limit": 100, "offset": 0},
    )
    return data.get("data", [])


@router.post("/api/user/promo", response_model=PromoApplyResponse)
async def apply_promo(req: PromoCodeRequest, session: dict = Depends(get_current_session)):
    """Применить промокод."""
    result = await shm_request(
        "POST", "/shm/v1/user/promo", session["shm_session"],
        json_data={"code": req.code},
    )
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg", "Промокод не найден или уже использован"))
    message = "Промокод применен"
    if isinstance(result, dict):
        message = result.get("msg") or result.get("message") or message
    return {"ok": True, "status": 200, "message": message, "code": req.code}


@router.get("/api/services", response_model=list[CatalogServiceOut])
async def get_services(session: dict = Depends(get_current_session)):
    try:
        admin_session = await get_admin_session()
        data = await shm_request("GET", "/shm/v1/admin/service", admin_session)
        return [normalize_catalog_service(s) for s in data.get("data", [])]
    except HTTPException:
        return []


@router.post("/api/services/buy", response_model=BuyServiceResponse)
async def buy_service(req: BuyServiceRequest, session: dict = Depends(get_current_session)):
    result = await shm_request(
        "PUT", "/shm/v1/service/order", session["shm_session"],
        json_data={"service_id": req.service_id},
    )
    logging.info("buy_service response: %s", result)
    # SHM может вернуть {"status": 4xx, "msg": "..."} c HTTP 200
    if isinstance(result, dict) and result.get("status") and int(result.get("status", 0)) >= 400:
        raise HTTPException(status_code=400, detail=result.get("msg", "Ошибка при покупке услуги"))

    order_list = result.get("data", []) if isinstance(result, dict) else []
    svc_raw = order_list[0] if order_list else {}
    svc_status = str(svc_raw.get("status", "")).upper()

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
