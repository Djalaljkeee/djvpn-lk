"""VPN client setup helpers: platform detection, deeplinks, QR code."""

import base64
import io
from typing import Optional

import segno
from fastapi import Request


# Happ в App Store живёт двумя независимыми листингами с РАЗНЫМИ id: Apple по
# требованию РКН удаляла клиент из российской витрины, разработчик перезаливал
# его под новым именем и новым id. Поэтому «безвитринная» ссылка не спасает —
# нужны обе. При очередном перезаливе меняется только константа ниже.
APPSTORE_HAPP_RU = "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6788279553"
APPSTORE_HAPP_INTL = "https://apps.apple.com/app/happ-proxy-utility/id6504287215"

HAPP_DOWNLOADS = {
    "ios":     APPSTORE_HAPP_RU,
    "android": "https://play.google.com/store/apps/details?id=com.happ.vpn",
    "windows": "https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe",
    "macos":   APPSTORE_HAPP_RU,
}

# Вторая витрина — только там, где листингов реально два.
HAPP_DOWNLOADS_INTL = {
    "ios":   APPSTORE_HAPP_INTL,
    "macos": APPSTORE_HAPP_INTL,
}

STORE_REGION_LABELS = {
    "ru":   "Российский App Store",
    "intl": "App Store других регионов",
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


def detect_store_region(accept_language: str) -> str:
    """Витрина App Store по Accept-Language: "ru" | "intl".

    Берём только ПЕРВЫЙ language-tag: в "en-US,ru;q=0.9" русский стоит вторым
    приоритетом, витрина у такого пользователя почти наверняка не российская.
    """
    primary = accept_language.split(",")[0].split(";")[0].strip().lower()
    return "ru" if primary == "ru" or primary.startswith("ru-") else "intl"


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

    primary_url = HAPP_DOWNLOADS.get(detected, HAPP_DOWNLOADS["windows"])
    alt_url = HAPP_DOWNLOADS_INTL.get(detected)
    alt_label = STORE_REGION_LABELS["intl"]

    # Язык устройства ≠ страна Apple ID, поэтому регион лишь решает, какая из
    # двух ссылок основная. Вторую всегда отдаём рядом, чтобы пользователь с
    # «неугаданной» витриной не упирался в «недоступно в вашем регионе».
    if alt_url and detect_store_region(request.headers.get("accept-language", "")) == "intl":
        primary_url, alt_url = alt_url, primary_url
        alt_label = STORE_REGION_LABELS["ru"]

    return {
        "platform": detected,
        "subscription_url": sub_url,
        "step1": {
            "title": "Скачайте приложение",
            "app_name": "Happ",
            "download_url": primary_url,
            "download_url_alt": alt_url,
            "download_alt_label": alt_label if alt_url else None,
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
