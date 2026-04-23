"""Uptime Kuma status proxy."""

from fastapi import APIRouter

from kuma_status import get_server_status_data


router = APIRouter()


@router.get("/api/status")
async def get_server_status():
    """Проксирует данные Uptime Kuma для отображения карточек статуса."""
    return await get_server_status_data()
