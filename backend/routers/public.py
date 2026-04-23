"""Public endpoints (no auth): config + captcha."""

import base64
import logging
import secrets
import time
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Response

from captcha import (
    CAPTCHA_IMAGES,
    extract_image_from_json,
    gc_captcha_images,
    pack_captcha_token,
)
from config import settings
from models import CaptchaResponse, PublicConfig


router = APIRouter()


@router.get("/api/config", response_model=PublicConfig)
async def get_public_config():
    """Публичная конфигурация для фронтенда."""
    return PublicConfig(telegram_bot_username=settings.TELEGRAM_BOT_USERNAME)


@router.get("/api/captcha", response_model=CaptchaResponse)
async def get_captcha():
    """Получить капчу от SHM. Возвращает data-URI и stateless-token,
    который фронт должен передать вместе с ответом пользователя.
    """
    gc_captcha_images()
    url = f"{settings.SHM_BASE_URL}/shm/v1/user/captcha"
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            resp = await client.get(url, headers={"Accept": "application/json, image/*"})
    except Exception as exc:
        logging.error("captcha: SHM error: %s", exc)
        raise HTTPException(status_code=503, detail="SHM недоступен")

    if resp.status_code != 200:
        logging.warning("captcha: SHM %s: %s", resp.status_code, resp.text[:200])
        raise HTTPException(status_code=resp.status_code, detail="Не удалось получить капчу")

    raw_content_type = (resp.headers.get("content-type") or "").lower()
    content_type = "image/png"
    data_uri: Optional[str] = None
    shm_session_from_body: Optional[str] = None
    raw_bytes: Optional[bytes] = None

    is_json = (
        "application/json" in raw_content_type
        or resp.content.strip().startswith(b"{")
        or resp.content.strip().startswith(b"[")
    )

    if is_json:
        try:
            payload = resp.json()
        except Exception as exc:
            logging.warning("captcha: JSON parse error: %s; body=%r", exc, resp.text[:400])
            payload = None

        if payload is not None:
            top_keys = list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__
            logging.info("captcha: SHM JSON keys=%s size=%d", top_keys, len(resp.content))

            image_val, mime_val, shm_session_from_body = extract_image_from_json(payload)
            if image_val:
                if image_val.startswith("data:"):
                    data_uri = image_val
                    try:
                        content_type = image_val.split(";", 1)[0].split(":", 1)[1] or "image/png"
                    except Exception:
                        content_type = "image/png"
                elif image_val.startswith("http"):
                    try:
                        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                            img_resp = await client.get(image_val)
                        if img_resp.status_code == 200:
                            raw_bytes = img_resp.content
                            content_type = img_resp.headers.get("content-type", "image/png").split(";")[0].strip()
                            data_uri = f"data:{content_type};base64,{base64.b64encode(raw_bytes).decode()}"
                    except Exception as exc:
                        logging.warning("captcha: image URL fetch failed: %s", exc)
                else:
                    mime = (mime_val or "image/png").strip()
                    if not mime.startswith("image/"):
                        mime = "image/png"
                    clean = image_val.split(",", 1)[-1].strip()
                    data_uri = f"data:{mime};base64,{clean}"
                    content_type = mime
                    try:
                        raw_bytes = base64.b64decode(clean + "=" * ((4 - len(clean) % 4) % 4))
                    except Exception:
                        raw_bytes = None
            else:
                logging.warning("captcha: no image field found in SHM JSON; keys=%s", top_keys)
    else:
        raw_bytes = resp.content
        content_type = raw_content_type.split(";")[0].strip() or "image/png"
        if not content_type.startswith("image/"):
            content_type = "image/png"
        data_uri = f"data:{content_type};base64,{base64.b64encode(raw_bytes).decode()}"

    if not data_uri:
        raise HTTPException(
            status_code=502,
            detail="Не удалось распарсить капчу SHM. См. логи сервера.",
        )

    # SHM может выдавать session-id капчи как cookie или как header/поле в теле.
    shm_cookie = (
        resp.cookies.get("session_id")
        or resp.headers.get("session-id")
        or shm_session_from_body
        or ""
    )
    if not shm_cookie:
        set_cookie = resp.headers.get("set-cookie") or ""
        for part in set_cookie.split(";"):
            if part.strip().startswith("session_id="):
                shm_cookie = part.strip().split("=", 1)[1]
                break

    token = pack_captcha_token(shm_cookie)

    # Сохраняем raw-байты, чтобы можно было отдать картинку через отдельный URL
    if raw_bytes:
        img_id = secrets.token_urlsafe(12)
        CAPTCHA_IMAGES[img_id] = (raw_bytes, content_type, time.time())
    else:
        img_id = None

    return CaptchaResponse(
        token=token,
        image=data_uri,
        content_type=content_type,
        image_url=f"/api/captcha/image/{img_id}" if img_id else None,
    )


@router.get("/api/captcha/image/{img_id}")
async def get_captcha_image_raw(img_id: str):
    """Отдаёт сохранённые raw-байты капчи (на случай, если base64 в data-URI
    по какой-то причине не сработал у клиента)."""
    gc_captcha_images()
    entry = CAPTCHA_IMAGES.get(img_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Captcha image not found or expired")
    data, mime, _ts = entry
    return Response(content=data, media_type=mime)
