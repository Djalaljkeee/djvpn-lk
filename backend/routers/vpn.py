"""VPN client setup endpoints: per-service config + raw URL setup."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from normalizers import normalize_user_service
from security import get_current_session
from shm_client import shm_request
from storage import fetch_sub_url_from_storage
from vpn_setup import build_setup_response


router = APIRouter()


@router.get("/api/user/service/{service_id}/config")
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

    # 2. Запрашиваем Marzban-хранилище под пользовательской SHM-сессией
    if not sub_url:
        sub_url = await fetch_sub_url_from_storage(
            service_id, session["shm_session"], session.get("user_id", 0)
        )

    if not sub_url:
        raise HTTPException(
            status_code=404,
            detail=f"Ссылка подписки не найдена для услуги {service_id}. Проверьте логи сервера."
        )

    return build_setup_response(sub_url, request, platform)


@router.get("/api/vpn/setup")
async def vpn_setup_by_url(
    url: str,
    request: Request,
    platform: Optional[str] = None,
    session: dict = Depends(get_current_session),
):
    """Конфигурация VPN-клиента по прямой ссылке подписки."""
    if not url:
        raise HTTPException(status_code=400, detail="URL подписки не указан")
    return build_setup_response(url, request, platform)
