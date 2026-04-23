"""SHM Cabinet — FastAPI backend (proxy).

Тонкий entrypoint: создаёт FastAPI-приложение, подключает CORS, роутеры
и (в проде) отдаёт статику SPA. Вся бизнес-логика распределена по модулям:

- config.py              — настройки (pydantic-settings)
- security.py            — JWT + HTTPBearer dependency
- models.py              — Pydantic-модели запросов/ответов + EMAIL_RE
- shm_client.py          — HTTP-клиент SHM + auth helpers
- remnawave_client.py    — HTTP-клиент Remnawave + resolve_remna_uuid
- telegram_auth.py       — верификация Telegram Login Widget
- captcha.py             — stateless-токен капчи + in-process кеш байтов
- storage.py             — SHM Marzban storage (vpn_mrzb_<id>)
- vpn_setup.py           — QR, deeplink, platform detection
- kuma_status.py         — Uptime Kuma прокси с мелким in-memory кешом
- normalizers.py         — конверсия SHM-полей в формат фронта
- routers/               — FastAPI-роутеры по доменам
"""

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from routers import auth, devices, payments, public, services, status, user, vpn


app = FastAPI(title="SHM Cabinet API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(auth.router)
app.include_router(user.router)
app.include_router(services.router)
app.include_router(devices.router)
app.include_router(payments.router)
app.include_router(vpn.router)
app.include_router(status.router)


# ---------------------------------------------------------------------------
# Serve static frontend (production)
# ---------------------------------------------------------------------------

if os.path.exists("../frontend/dist"):
    app.mount("/assets", StaticFiles(directory="../frontend/dist/assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        return FileResponse("../frontend/dist/index.html")
