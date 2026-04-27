"""Pydantic request/response models used across routers."""

import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    login: str
    password: str


class RegisterRequest(BaseModel):
    login: Optional[str] = None  # опционален — используется email, если не задан
    password: str
    name: Optional[str] = None
    email: str
    captcha_token: Optional[str] = None
    captcha_code: Optional[str] = None


class EmailVerifyRequest(BaseModel):
    token: str


class TelegramAuthRequest(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str


class PaymentRequest(BaseModel):
    pay_system_id: int
    amount: float


class BuyServiceRequest(BaseModel):
    service_id: int


class ChangeServiceRequest(BaseModel):
    user_service_id: int
    service_id: int


class StopServiceRequest(BaseModel):
    user_service_id: int


class PromoCodeRequest(BaseModel):
    code: str


class DeleteServiceRequest(BaseModel):
    user_service_id: int


class DeleteDeviceRequest(BaseModel):
    hwid: str
    user_service_id: int


class DeleteAllDevicesRequest(BaseModel):
    user_service_id: int


class UpdateEmailRequest(BaseModel):
    email: str


class ChangePasswordRequest(BaseModel):
    password: str


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class EmailVerifyResponse(BaseModel):
    ok: bool = True
    verified: bool = False
    message: str = ""


class CaptchaResponse(BaseModel):
    token: str
    image: str  # data:image/png;base64,...
    content_type: str = "image/png"
    image_url: Optional[str] = None  # прямая ссылка на raw-байты (fallback)


class BuyServiceResponse(BaseModel):
    success: bool = True
    needs_topup: bool = False
    amount_needed: float = 0.0
    balance: float = 0.0
    message: str = ""


class ChangeServiceResponse(BaseModel):
    success: bool = True
    needs_topup: bool = False
    amount_needed: float = 0.0
    balance: float = 0.0
    message: str = ""


class UserProfile(BaseModel):
    user_id: int
    login: str
    name: Optional[str] = None
    balance: float = 0
    credit: float = 0
    status: int = 1
    created: Optional[str] = None
    email: Optional[str] = None
    email_verified: Optional[bool] = None


class UserServiceOut(BaseModel):
    id: Optional[int] = None
    service_id: Optional[int] = None
    name: str = ""
    status: int = 0
    created: Optional[str] = None
    expired: Optional[str] = None
    cost: Optional[float] = None
    period: Optional[int] = None
    period_type: str = "month"
    descr: Optional[str] = None
    subscription_url: Optional[str] = None


class PaymentOut(BaseModel):
    id: Optional[int] = None
    amount: float = 0
    pay_system_id: Optional[str] = None   # SHM: строка, напр. 'yookassa'
    pay_system_name: Optional[str] = None
    created: Optional[str] = None
    status: int = 1
    comment: Optional[str] = None


class CatalogServiceOut(BaseModel):
    service_id: Optional[int] = None
    name: str = ""
    cost: float = 0
    period: int = 1
    period_type: str = "month"
    descr: Optional[str] = None
    category: Optional[str] = None
    status: int = 1
    order_only_once: bool = False


class PaySystemOut(BaseModel):
    pay_system_id: int
    name: str
    currency: Optional[str] = None
    min_amount: Optional[float] = None
    commission: Optional[float] = None


class AuthResponse(BaseModel):
    token: str
    user: UserProfile
    email_verification_sent: bool = False


class WebappUrlResponse(BaseModel):
    url: str


class PublicConfig(BaseModel):
    telegram_bot_username: str


class PaySystemV2Out(BaseModel):
    model_config = {"extra": "ignore"}
    name: str
    shm_url: str
    paysystem: Optional[str] = None
    recurring: Optional[int] = None
    allow_deletion: Optional[int] = None
    internal: Optional[int] = None
    weight: Optional[int] = None
    min_sum: Optional[float] = None
    max_sum: Optional[float] = None


class ReferralEntryOut(BaseModel):
    user_id: Optional[int] = None
    login: Optional[str] = None
    name: Optional[str] = None
    created: Optional[str] = None
    income: float = 0
    total: Optional[int] = None


class ReferralSummaryOut(BaseModel):
    total_referrals: int = 0
    total_income: float = 0
    items: int = 0
    referrals: Optional[List[ReferralEntryOut]] = None


class PromoApplyResponse(BaseModel):
    ok: bool = True
    status: int = 200
    message: str = ""
    code: str = ""


class ForecastNextItem(BaseModel):
    bonus: float = 0
    cost: float = 0
    discount: float = 0
    months: float = 0
    name: str = ""
    qnt: int = 1
    service_id: Optional[int] = None
    total: float = 0


class ForecastServiceItem(BaseModel):
    cost: float = 0
    discount: float = 0
    expire: Optional[str] = None
    months: float = 0
    name: str = ""
    next: Optional[ForecastNextItem] = None
    qnt: int = 1
    service_id: Optional[str] = None
    status: Optional[str] = None
    total: float = 0
    user_service_id: Optional[str] = None
    usi: Optional[str] = None


class ForecastEntry(BaseModel):
    balance: float = 0
    bonuses: float = 0
    dept: float = 0
    items: list[ForecastServiceItem] = []
    total: float = 0


class ForecastResponse(BaseModel):
    data: list[ForecastEntry] = []


class DeviceOut(BaseModel):
    hwid: str
    platform: Optional[str] = None
    deviceModel: Optional[str] = None
    last_seen: Optional[str] = None
    userAgent: Optional[str] = None


class ServiceDevicesOut(BaseModel):
    service_id: int
    service_name: str
    user_service_id: int
    devices: list[DeviceOut] = []


class RemnaUserInfo(BaseModel):
    user_service_id: int
    used_traffic_bytes: Optional[int] = None
    traffic_limit_bytes: Optional[int] = None
    limit_ip: Optional[int] = None
    hwid_device_limit: Optional[int] = None
    online_at: Optional[str] = None
    locations: list[str] = []


class VpnSetupResponse(BaseModel):
    platform: str
    subscription_url: str
    step1: dict    # скачать
    step2: dict    # подключиться
    fallback: dict  # ручная настройка


# ---------------------------------------------------------------------------
# Aggregated dashboard (GET /api/dashboard)
# ---------------------------------------------------------------------------

class DashboardBalance(BaseModel):
    amount: float = 0
    currency: str = "RUB"


class DashboardResponse(BaseModel):
    """Агрегированный ответ для личного кабинета.

    Каждый блок может быть `None`, если соответствующий апстрим упал — см.
    `errors: {block: error_message}`. Частичные ответы не кешируются.
    """
    profile: Optional[UserProfile] = None
    balance: Optional[DashboardBalance] = None
    services: Optional[List[UserServiceOut]] = None
    devices: Optional[List[ServiceDevicesOut]] = None
    remna_info: Optional[List[RemnaUserInfo]] = None
    # `orders` — список услуг, доступных пользователю к заказу
    # (фронт использует поле `service_id` для проверки доступности trial).
    orders: Optional[List[Dict[str, Any]]] = None
    payments: Optional[List[PaymentOut]] = None
    paysystems: Optional[List[PaySystemV2Out]] = None
    forecast: Optional[ForecastResponse] = None
    notifications: Optional[Dict[str, Any]] = None
    status: Optional[Dict[str, Any]] = None
    maintenance: Dict[str, Any] = Field(default_factory=dict)
    errors: Dict[str, str] = Field(default_factory=dict)
