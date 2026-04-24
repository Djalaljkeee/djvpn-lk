"""User devices (Remnawave HWID) and traffic info."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException

from models import (
    DeleteAllDevicesRequest,
    DeleteDeviceRequest,
    DeviceOut,
    RemnaUserInfo,
    ServiceDevicesOut,
)
from remnawave_client import remnawave_request, resolve_remna_uuid
from security import get_current_session
from shm_client import shm_request


router = APIRouter()


@router.get("/api/user/devices", response_model=list[ServiceDevicesOut])
async def get_user_devices(session: dict = Depends(get_current_session)):
    """Получить HWID-устройства пользователя, сгруппированные по услугам."""
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])

    user_id = session.get("user_id", 0)

    async def fetch_devices_for_service(svc: dict) -> ServiceDevicesOut:
        user_service_id = svc.get("user_service_id")
        service_info = svc.get("service") or {}
        service_name = service_info.get("name") or svc.get("name", "")
        service_id = svc.get("service_id", 0)
        try:
            uuid = await resolve_remna_uuid(user_service_id, svc, user_id)
            if not uuid:
                raise ValueError("no uuid")
            remna_data = await remnawave_request("GET", f"/api/hwid/devices/{uuid}")
            response = remna_data.get("response") or {}
            devices_raw = response.get("devices") or []
            devices = [DeviceOut(**d) for d in devices_raw if isinstance(d, dict)]
        except Exception as e:
            logging.warning("get_devices usi=%s: %s", user_service_id, e)
            devices = []
        return ServiceDevicesOut(
            service_id=service_id,
            service_name=service_name,
            user_service_id=user_service_id,
            devices=devices,
        )

    valid_services = [s for s in raw_list if s.get("user_service_id")]
    results = await asyncio.gather(*[fetch_devices_for_service(s) for s in valid_services])
    return list(results)


@router.delete("/api/user/devices")
async def delete_user_device(req: DeleteDeviceRequest, session: dict = Depends(get_current_session)):
    """Удалить HWID-устройство пользователя."""
    if not req.hwid:
        raise HTTPException(status_code=400, detail="hwid обязателен")

    # Проверить, что user_service_id принадлежит текущему пользователю
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    valid_ids = {svc.get("user_service_id") for svc in raw_list}
    if req.user_service_id not in valid_ids:
        raise HTTPException(status_code=403, detail="Нет доступа к этой услуге")

    target_svc = next((s for s in raw_list if s.get("user_service_id") == req.user_service_id), None)
    user_uuid = await resolve_remna_uuid(req.user_service_id, target_svc, session.get("user_id", 0))
    if not user_uuid:
        raise HTTPException(status_code=404, detail="UUID не найден для этой услуги")
    return await remnawave_request(
        "POST", "/api/hwid/devices/delete",
        json_data={"userUuid": user_uuid, "hwid": req.hwid},
    )


@router.get("/api/user/remna-info", response_model=list[RemnaUserInfo])
async def get_remna_info(session: dict = Depends(get_current_session)):
    """Получить данные Remnawave (трафик, лимит устройств, локации) по каждой услуге."""
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    valid_services = [s for s in raw_list if s.get("user_service_id")]
    user_id = session.get("user_id", 0)

    async def fetch_remna_user(svc: dict) -> RemnaUserInfo:
        user_service_id = svc["user_service_id"]
        try:
            uuid = await resolve_remna_uuid(user_service_id, svc, user_id)
            if not uuid:
                logging.warning("get_remna_info usi=%s: no uuid", user_service_id)
                return RemnaUserInfo(user_service_id=user_service_id)
            resp = await remnawave_request("GET", f"/api/users/{uuid}")
            user_data = resp.get("response") or resp
            inbounds = user_data.get("activeUserInbounds") or user_data.get("inbounds") or []
            tags = []
            for inb in inbounds:
                tag = inb.get("tag") or inb.get("inboundTag") or inb.get("name")
                if tag:
                    tags.append(tag)
            traffic = user_data.get("userTraffic") or {}
            used = traffic.get("usedTrafficBytes") or user_data.get("usedTrafficBytes")
            online = traffic.get("onlineAt") or user_data.get("onlineAt")
            return RemnaUserInfo(
                user_service_id=user_service_id,
                used_traffic_bytes=used,
                traffic_limit_bytes=user_data.get("trafficLimitBytes"),
                limit_ip=user_data.get("limitIp"),
                hwid_device_limit=user_data.get("hwidDeviceLimit"),
                online_at=online,
                locations=tags,
            )
        except Exception as e:
            logging.warning("get_remna_info usi=%s: %s", user_service_id, e)
            return RemnaUserInfo(user_service_id=user_service_id)

    results = await asyncio.gather(*[fetch_remna_user(s) for s in valid_services])
    return list(results)


@router.delete("/api/user/devices/all")
async def delete_all_user_devices(req: DeleteAllDevicesRequest, session: dict = Depends(get_current_session)):
    """Удалить все HWID-устройства пользователя для одной услуги."""
    data = await shm_request("GET", "/shm/v1/user/service", session["shm_session"])
    raw_list = data.get("data", [])
    valid_ids = {svc.get("user_service_id") for svc in raw_list}
    if req.user_service_id not in valid_ids:
        raise HTTPException(status_code=403, detail="Нет доступа к этой услуге")

    target_svc = next((s for s in raw_list if s.get("user_service_id") == req.user_service_id), None)
    user_uuid = await resolve_remna_uuid(req.user_service_id, target_svc, session.get("user_id", 0))
    if not user_uuid:
        raise HTTPException(status_code=404, detail="UUID не найден для этой услуги")
    remna_data = await remnawave_request("GET", f"/api/hwid/devices/{user_uuid}")
    devices_raw = (remna_data.get("response") or {}).get("devices") or []

    deleted, failed = 0, 0
    for d in devices_raw:
        hwid = d.get("hwid")
        if not hwid:
            continue
        try:
            await remnawave_request("POST", "/api/hwid/devices/delete",
                                    json_data={"userUuid": user_uuid, "hwid": hwid})
            deleted += 1
        except Exception:
            failed += 1
    return {"deleted": deleted, "failed": failed}
