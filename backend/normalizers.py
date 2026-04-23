"""SHM → frontend field normalizers."""

import json as _json
import logging


_SERVICE_STATUS = {
    "ACTIVE": 1, "BLOCK": 2, "NOT PAID": 2,
    "STUCK": 2, "REMOVED": 3, "INIT": 0, "PROGRESS": 0,
}


def normalize_user_service(svc: dict) -> dict:
    info = svc.get("service") or {}
    # SHM хранит доп. данные (Marzban subscriptionUrl и т.д.) в поле data,
    # которое может быть как dict, так и JSON-строкой
    raw_data = svc.get("data") or {}
    if isinstance(raw_data, str):
        try:
            data = _json.loads(raw_data)
        except Exception:
            data = {}
    else:
        data = raw_data

    logging.debug("normalize_user_service svc keys=%s data=%s", list(svc.keys()), data)

    # Subscription URL: SHM Marzban module stores it in multiple places
    sub_url = (
        svc.get("subscription_url")
        or svc.get("subscriptionUrl")
        or data.get("subscription_url")
        or data.get("subscriptionUrl")
        or (info.get("data") or {}).get("subscriptionUrl") if isinstance(info.get("data"), dict) else None
    )
    return {
        "id":               svc.get("user_service_id"),
        "service_id":       svc.get("service_id"),
        "name":             info.get("name") or svc.get("name", ""),
        "status":           _SERVICE_STATUS.get(str(svc.get("status", "")), 0),
        "created":          svc.get("created"),
        "expired":          svc.get("expire"),          # SHM: expire, not expired
        "cost":             info.get("cost") or svc.get("cost"),
        "period":           svc.get("period") or svc.get("period_cost"),
        "period_type":      svc.get("period_type", "month"),
        "descr":            info.get("descr") or svc.get("descr"),
        "subscription_url": sub_url,
        "remna_uuid":       data.get("uuid"),
    }


_PAY_SYSTEM_NAMES: dict[str, str] = {
    "yookassa":          "ЮKassa",
    "yookassa-canceled": "Отменён (ЮKassa)",
    "yookassa-refund":   "Возврат (ЮKassa)",
}


def normalize_payment(pay: dict) -> dict:
    return {
        "id":              pay.get("id"),
        "amount":          float(pay.get("money") or 0),  # SHM: money, not amount
        "pay_system_id":   str(pay.get("pay_system_id") or ""),
        "pay_system_name": _PAY_SYSTEM_NAMES.get(str(pay.get("pay_system_id") or ""), str(pay.get("pay_system_id") or "")),
        "created":         pay.get("date"),               # SHM: date, not created
        "status":          1 if str(pay.get("pay_system_id") or "").find("canceled") < 0 and str(pay.get("pay_system_id") or "").find("refund") < 0 else 0,
        "comment":         pay.get("comment"),
    }


def normalize_catalog_service(svc: dict) -> dict:
    allow = svc.get("allow_to_order", 1)
    return {
        "service_id":     svc.get("id") or svc.get("service_id"),
        "name":           svc.get("name", ""),
        "cost":           float(svc.get("cost") or 0),
        "period":         int(svc.get("period_cost") or svc.get("period") or 1),
        "period_type":    svc.get("period_type", "month"),
        "descr":          svc.get("descr"),
        "category":       svc.get("category"),
        "status":         1 if allow else 0,
        "order_only_once": bool(svc.get("order_only_once", False)),
    }


def is_insufficient_funds_msg(text: str) -> bool:
    if not text:
        return False
    low = text.lower()
    return any(marker in low for marker in (
        "no money", "insufficient", "not enough", "недостаточно", "недостаточ",
    ))
