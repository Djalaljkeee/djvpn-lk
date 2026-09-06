"""VPN client setup helpers: platform detection, deeplinks, QR code."""

import base64
import io
from typing import Dict, NamedTuple, Optional

import segno
from fastapi import Request


class ClientApp(NamedTuple):
    """Клиент, который кабинет предлагает поставить на конкретной платформе."""

    name: str
    #: Префикс диплинка импорта: к нему как есть приклеивается ссылка подписки.
    deeplink_scheme: str
    downloads: Dict[str, str]
    #: Вторая витрина App Store — только там, где листингов действительно два.
    downloads_intl: Dict[str, str]


# Happ в App Store живёт двумя независимыми листингами с РАЗНЫМИ id: Apple по
# требованию РКН удаляла клиент из российской витрины, разработчик перезаливал
# его под новым именем и новым id. Поэтому «безвитринная» ссылка не спасает —
# нужны обе. При очередном перезаливе меняется только константа ниже.
APPSTORE_HAPP_RU = "https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6788279553"
APPSTORE_HAPP_INTL = "https://apps.apple.com/app/happ-proxy-utility/id6504287215"

# INCY (llc.itdev.incy) — клиент для iOS. Карточка одна и лежит в российской
# витрине, поэтому второй ссылки для него нет и «недоступно в вашем регионе»
# на iOS больше не ловим. Тот же выбор сделан на странице подписки Remnawave:
# там iOS → INCY с диплинком incy://import/.
APPSTORE_INCY = "https://apps.apple.com/ru/app/incy/id6756943388"

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

HAPP = ClientApp(
    name="Happ",
    deeplink_scheme="happ://add/",
    downloads=HAPP_DOWNLOADS,
    downloads_intl=HAPP_DOWNLOADS_INTL,
)

INCY = ClientApp(
    name="INCY",
    deeplink_scheme="incy://import/",
    downloads={"ios": APPSTORE_INCY},
    downloads_intl={},
)

# Платформы, где мы выдаём не Happ. Остальные — DEFAULT_APP.
APPS_BY_PLATFORM = {
    "ios": INCY,
}
DEFAULT_APP = HAPP

STORE_REGION_LABELS = {
    "ru":   "Российский App Store",
    "intl": "App Store других регионов",
}


def app_for_platform(platform: str) -> ClientApp:
    return APPS_BY_PLATFORM.get(platform, DEFAULT_APP)


# Ссылки сразу под все платформы: на каждой — то приложение, которое мы там
# рекомендуем. Набор платформ задаёт Happ, он есть везде.
ALL_DOWNLOADS = {
    platform: app_for_platform(platform).downloads[platform]
    for platform in HAPP_DOWNLOADS
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


def build_deeplink(subscription_url: str, platform: str = "") -> str:
    return f"{app_for_platform(platform).deeplink_scheme}{subscription_url}"


def generate_qr_base64(data: str) -> str:
    """QR code → PNG data-URI (base64)."""
    qr = segno.make(data)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=8, dark="#000000", light="#ffffff")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def build_setup_response(sub_url: str, request: Request, platform: Optional[str]) -> dict:
    detected = platform or detect_platform(request.headers.get("user-agent", ""))
    app = app_for_platform(detected)
    deeplink = build_deeplink(sub_url, detected)
    qr_data = generate_qr_base64(deeplink)

    # Неизвестная платформа (linux и прочее) — как и раньше, десктопный Happ.
    primary_url = app.downloads.get(detected, HAPP_DOWNLOADS["windows"])
    alt_url = app.downloads_intl.get(detected)
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
            "app_name": app.name,
            "download_url": primary_url,
            "download_url_alt": alt_url,
            "download_alt_label": alt_label if alt_url else None,
            "all_downloads": ALL_DOWNLOADS,
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
                f"1. Откройте приложение {app.name}\n"
                "2. Нажмите «+» → «Добавить подписку»\n"
                "3. Вставьте скопированную ссылку"
            ),
            "copy_link": sub_url,
        },
    }
