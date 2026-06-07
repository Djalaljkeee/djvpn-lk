"""SHM Marzban storage helpers (vpn_mrzb_<id> records)."""

import json
import logging
from typing import Optional

from config import settings
from http_retry import request_with_connect_retry
from shm_client import get_shm_client


async def fetch_storage_data(user_service_id: int, session_id: str, user_id: int = 0) -> dict:
    """Fetch full JSON from SHM Marzban storage: vpn_mrzb_{id}.

    Использует session_id текущего пользователя (cookie SHM) вместо admin-сессии.
    Возвращает dict с полями subscriptionUrl, uuid и пр.
    """
    if not session_id:
        return {}
    url = f"{settings.SHM_BASE_URL}/shm/v1/storage/manage/vpn_mrzb_{user_service_id}"
    try:
        params = {"user_id": user_id} if user_id else {}
        client = get_shm_client()
        resp = await request_with_connect_retry(
            client, "GET", url, label=f"storage:vpn_mrzb_{user_service_id}",
            cookies={"session_id": session_id},
            headers={"Accept": "text/plain, application/json"},
            params=params,
        )
        if resp.status_code != 200:
            logging.warning("_fetch_storage_data(usi=%s, user_id=%s) HTTP %s: %s",
                            user_service_id, user_id, resp.status_code, resp.text[:200])
            return {}
        text = resp.text.strip()
        if not text:
            logging.warning("_fetch_storage_data(usi=%s, user_id=%s) empty body", user_service_id, user_id)
            return {}
        try:
            return json.loads(text)
        except Exception as e:
            logging.warning("_fetch_storage_data(usi=%s) json parse error: %s; body=%r",
                            user_service_id, e, text[:200])
            return {}
    except Exception as e:
        logging.warning("_fetch_storage_data(%s) error: %s", user_service_id, e)
    return {}


async def fetch_sub_url_from_storage(user_service_id: int, session_id: str, user_id: int = 0) -> Optional[str]:
    data = await fetch_storage_data(user_service_id, session_id, user_id)
    return data.get("subscriptionUrl") or data.get("subscription_url")
