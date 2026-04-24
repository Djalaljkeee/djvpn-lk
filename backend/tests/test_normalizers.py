"""Нормализаторы SHM-полей: поведение не меняется при рефакторинге."""

from normalizers import (
    is_insufficient_funds_msg,
    normalize_catalog_service,
    normalize_payment,
    normalize_user_service,
)


def test_normalize_user_service_maps_fields():
    raw = {
        "user_service_id": 42,
        "service_id": 7,
        "status": "ACTIVE",
        "created": "2026-01-01",
        "expire": "2026-02-01",
        "period": 1,
        "period_type": "month",
        "service": {"name": "VPN Pro", "cost": 199.0, "descr": "pro"},
        "data": {"subscriptionUrl": "https://x/sub/abc", "uuid": "u-1"},
    }
    out = normalize_user_service(raw)
    assert out["id"] == 42
    assert out["service_id"] == 7
    assert out["name"] == "VPN Pro"
    assert out["status"] == 1  # ACTIVE → 1
    assert out["expired"] == "2026-02-01"
    assert out["subscription_url"] == "https://x/sub/abc"
    assert out["remna_uuid"] == "u-1"


def test_normalize_user_service_parses_json_string_data():
    raw = {
        "user_service_id": 1,
        "status": "BLOCK",
        "data": '{"subscriptionUrl": "https://x/s", "uuid": "u"}',
        "service": {},
    }
    out = normalize_user_service(raw)
    assert out["status"] == 2  # BLOCK → 2
    assert out["subscription_url"] == "https://x/s"
    assert out["remna_uuid"] == "u"


def test_normalize_payment_uses_money_and_date():
    raw = {"id": 5, "money": "199.5", "date": "2026-01-02", "pay_system_id": "yookassa"}
    out = normalize_payment(raw)
    assert out["id"] == 5
    assert out["amount"] == 199.5
    assert out["created"] == "2026-01-02"
    assert out["pay_system_name"] == "ЮKassa"
    assert out["status"] == 1


def test_normalize_payment_detects_refund():
    raw = {"id": 6, "money": "10", "pay_system_id": "yookassa-refund"}
    out = normalize_payment(raw)
    assert out["status"] == 0


def test_normalize_catalog_service_defaults():
    raw = {"id": 9, "name": "Month", "cost": "99", "period_cost": "1"}
    out = normalize_catalog_service(raw)
    assert out["service_id"] == 9
    assert out["cost"] == 99.0
    assert out["period"] == 1
    assert out["status"] == 1


def test_is_insufficient_funds_msg_recognizes_variants():
    assert is_insufficient_funds_msg("No money on balance")
    assert is_insufficient_funds_msg("недостаточно средств")
    assert is_insufficient_funds_msg("Insufficient balance")
    assert not is_insufficient_funds_msg("")
    assert not is_insufficient_funds_msg("OK")
