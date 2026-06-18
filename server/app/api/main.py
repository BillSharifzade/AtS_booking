import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import (
    articles,
    audit,
    auth,
    bookings,
    bot_texts,
    chat,
    checklist,
    client,
    companies,
    notifications,
    offtimes,
    panel_users,
    props,
    reports,
    rooms,
    users,
    zones,
)
from app.config import settings
from app.telegram import get_bot

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 64 * 1024 * 1024  # cap request bodies (base64 image uploads, etc.)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if len(settings.jwt_secret) < 32:
        log.warning(
            "JWT_SECRET is short (%d chars). Use a long, random secret (>=32) in production.",
            len(settings.jwt_secret),
        )
    get_bot()  # warm up
    yield


app = FastAPI(title="AtS Booking API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl is not None and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Запрос слишком большой."})
    return await call_next(request)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router)
app.include_router(zones.router)
app.include_router(rooms.router)
app.include_router(bookings.router)
app.include_router(audit.router)
app.include_router(users.router)
app.include_router(bot_texts.router)
app.include_router(chat.router)
app.include_router(notifications.router)
app.include_router(reports.router)
app.include_router(panel_users.router)
app.include_router(companies.router)
app.include_router(props.router)
app.include_router(checklist.router)
app.include_router(offtimes.router)
app.include_router(articles.router)
app.include_router(client.router)
