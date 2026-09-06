"""Тесты выбора клиента, ссылок на установку и сборки ответа /vpn/setup."""

from __future__ import annotations

import pytest

from vpn_setup import (
    ALL_DOWNLOADS,
    APPSTORE_HAPP_INTL,
    APPSTORE_INCY,
    HAPP_DOWNLOADS,
    HAPP_MACOS_DMG,
    build_deeplink,
    build_setup_response,
)


SUB_URL = "https://vpn.example.com/sub/abc123"


class FakeRequest:
    """Минимальная заглушка Request — build_setup_response читает только headers."""

    def __init__(self, **headers):
        self.headers = {k.replace("_", "-"): v for k, v in headers.items()}


@pytest.mark.parametrize("accept_language", ["ru-RU,ru;q=0.9", "en-US,en;q=0.9"])
def test_ios_gets_incy_from_single_store(accept_language):
    """У INCY одна карточка — витрина роли не играет, второй ссылки нет."""
    data = build_setup_response(SUB_URL, FakeRequest(accept_language=accept_language), "ios")
    step1 = data["step1"]

    assert step1["app_name"] == "INCY"
    assert step1["download_url"] == APPSTORE_INCY
    assert step1["download_url_alt"] is None
    assert step1["download_alt_label"] is None


def test_ios_deeplink_uses_incy_scheme():
    data = build_setup_response(SUB_URL, FakeRequest(accept_language="ru"), "ios")

    assert data["step2"]["deeplink"] == f"incy://import/{SUB_URL}"
    assert "INCY" in data["fallback"]["instruction"]


@pytest.mark.parametrize("platform", ["android", "macos", "windows", "linux"])
def test_other_platforms_stay_on_happ(platform):
    data = build_setup_response(SUB_URL, FakeRequest(accept_language="ru"), platform)

    assert data["step1"]["app_name"] == "Happ"
    assert data["step2"]["deeplink"] == f"happ://add/{SUB_URL}"


@pytest.mark.parametrize("accept_language", ["ru", "de-DE"])
def test_macos_gets_the_dmg_with_app_store_as_a_fallback(accept_language):
    """Российской карточки Happ больше нет, поэтому .dmg — всем и всегда."""
    step1 = build_setup_response(SUB_URL, FakeRequest(accept_language=accept_language), "macos")["step1"]

    assert step1["download_url"] == HAPP_MACOS_DMG
    assert step1["download_url_alt"] == APPSTORE_HAPP_INTL
    assert step1["download_alt_label"]


@pytest.mark.parametrize("platform", ["android", "windows"])
def test_platforms_with_a_single_source_have_no_alt_link(platform):
    step1 = build_setup_response(SUB_URL, FakeRequest(accept_language="en-US"), platform)["step1"]

    assert step1["download_url"] == HAPP_DOWNLOADS[platform]
    assert step1["download_url_alt"] is None
    assert step1["download_alt_label"] is None


def test_unknown_platform_falls_back_to_windows_build():
    step1 = build_setup_response(SUB_URL, FakeRequest(), "linux")["step1"]

    assert step1["download_url"] == HAPP_DOWNLOADS["windows"]
    assert step1["download_url_alt"] is None


def test_all_downloads_lists_the_app_we_recommend_per_platform():
    assert ALL_DOWNLOADS["ios"] == APPSTORE_INCY
    assert ALL_DOWNLOADS["macos"] == HAPP_MACOS_DMG
    assert ALL_DOWNLOADS["android"] == HAPP_DOWNLOADS["android"]
    assert ALL_DOWNLOADS["windows"] == HAPP_DOWNLOADS["windows"]


def test_build_deeplink_defaults_to_happ_without_platform():
    assert build_deeplink(SUB_URL) == f"happ://add/{SUB_URL}"


def test_works_with_real_starlette_request():
    """Заглушка выше — dict; проверяем и настоящий ASGI-путь до request.headers."""
    from starlette.requests import Request

    def asgi_request(accept_language: str) -> Request:
        return Request({
            "type": "http",
            "headers": [
                (b"user-agent", b"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
                (b"accept-language", accept_language.encode()),
            ],
        })

    ru = build_setup_response(SUB_URL, asgi_request("ru-RU,ru;q=0.9"), None)
    intl = build_setup_response(SUB_URL, asgi_request("tr-TR"), None)

    assert ru["platform"] == intl["platform"] == "ios"
    assert ru["step1"]["download_url"] == intl["step1"]["download_url"] == APPSTORE_INCY


def test_platform_detected_from_user_agent_when_not_forced():
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    data = build_setup_response(SUB_URL, FakeRequest(user_agent=ua, accept_language="ru"), None)

    assert data["platform"] == "ios"
    assert data["step1"]["download_url"] == APPSTORE_INCY
