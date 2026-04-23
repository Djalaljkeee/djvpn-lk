"""SHM captcha helpers: stateless token + in-process image cache."""

import time
from typing import Optional

from jose import JWTError, jwt

from config import settings


_CAPTCHA_TTL = 600  # 10 минут


def pack_captcha_token(shm_cookie: str) -> str:
    payload = {
        "c": shm_cookie or "",
        "exp": int(time.time()) + _CAPTCHA_TTL,
        "iat": int(time.time()),
        "typ": "captcha",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def unpack_captcha_token(token: Optional[str]) -> Optional[dict]:
    """Возвращает {cookie: str} если токен валиден, иначе None."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except JWTError:
        return None
    if payload.get("typ") != "captcha":
        return None
    return {"cookie": payload.get("c", "")}


# Дополнительное in-process хранилище для raw bytes капчи,
# чтобы отдавать картинку по прямой ссылке (fallback, если JSON-парсинг
# не нашёл base64). Ключ — короткий токен, значение — (bytes, mime, ts).
CAPTCHA_IMAGES: dict[str, tuple[bytes, str, float]] = {}
CAPTCHA_IMG_TTL = 600


def gc_captcha_images() -> None:
    now = time.time()
    expired = [k for k, (_, _, ts) in CAPTCHA_IMAGES.items() if now - ts > CAPTCHA_IMG_TTL]
    for k in expired:
        CAPTCHA_IMAGES.pop(k, None)


def extract_image_from_json(payload) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Достаёт (base64_image, mime, session_from_body) из произвольного JSON-ответа SHM.

    Идёт вглубь по наиболее вероятным путям: top-level, .data[0], .data (dict),
    .result, .captcha. Ищет поля image / captcha / data / base64 / png / img / src.
    """
    mime = None
    session = None

    def _pick_session(obj: dict) -> Optional[str]:
        for k in ("session_id", "captcha_id", "captcha_session", "id"):
            v = obj.get(k)
            if isinstance(v, str) and v:
                return v
        return None

    def _looks_like_base64(s: str) -> bool:
        if not s or len(s) < 40:
            return False
        sample = s[:200]
        allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=-_\n\r ")
        return all(ch in allowed for ch in sample)

    def _pick_image(obj: dict) -> Optional[str]:
        nonlocal mime
        for k in ("image", "captcha", "base64", "png", "img", "src", "url", "data"):
            v = obj.get(k)
            if isinstance(v, str) and v and (v.startswith("data:") or _looks_like_base64(v) or v.startswith("http")):
                m = obj.get("content_type") or obj.get("mime") or obj.get("type")
                if isinstance(m, str):
                    mime = m
                return v
        return None

    candidates = []
    if isinstance(payload, dict):
        candidates.append(payload)
        for key in ("data", "result", "captcha", "response"):
            v = payload.get(key)
            if isinstance(v, dict):
                candidates.append(v)
            elif isinstance(v, list) and v and isinstance(v[0], dict):
                candidates.append(v[0])
    elif isinstance(payload, list) and payload and isinstance(payload[0], dict):
        candidates.append(payload[0])

    for node in candidates:
        if session is None:
            session = _pick_session(node)
        img = _pick_image(node)
        if img:
            return img, mime, session

    return None, mime, session
