"""VPN client setup helpers: platform detection, deeplinks, QR code."""

import base64
import io
from typing import Optional

import segno
from fastapi import Request


HAPP_DOWNLOADS = {
    "ios":     "https://apps.apple.com/app/happ/id6744897585",
    "android": "https://play.google.com/store/apps/details?id=com.happ.vpn",
    "windows": "https://github.com/hiddify/hiddify-app/releases/latest",
    "macos":   "https://apps.apple.com/app/happ/id6744897585",
}


def detect_platform(ua: str) -> str:
    ua = ua.lower()
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return "ios"
    if "android" in ua:
        return "android"
    if "mac" in ua:
        return "macos"
    return "windows"


def build_deeplink(subscription_url: str) -> str:
    return f"happ://add/{subscription_url}"


def generate_qr_base64(data: str) -> str:
    """QR code → PNG data-URI (base64)."""
    qr = segno.make(data)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=8, dark="#000000", light="#ffffff")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def build_setup_response(sub_url: str, request: Request, platform: Optional[str]) -> dict:
    detected = platform or detect_platform(request.headers.get("user-agent", ""))
    deeplink = build_deeplink(sub_url)
    qr_data = generate_qr_base64(deeplink)

    return {
        "platform": detected,
        "subscription_url": sub_url,
        "step1": {
            "title": "Скачайте приложение",
            "app_name": "Happ",
            "download_url": HAPP_DOWNLOADS.get(detected, HAPP_DOWNLOADS["windows"]),
            "all_downloads": HAPP_DOWNLOADS,
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
