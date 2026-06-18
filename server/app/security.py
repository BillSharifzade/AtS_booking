import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl

from jose import JWTError, jwt

from app.config import settings


def generate_login_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str) -> str:
    return hashlib.sha256(f"{settings.jwt_secret}:{code}".encode()).hexdigest()


def verify_code(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_code(code), code_hash)


def create_jwt(telegram_id: int, role: str = "admin") -> tuple[str, datetime]:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_ttl_hours)
    payload = {"sub": str(telegram_id), "role": role, "exp": expires_at}
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, expires_at


class InitDataError(ValueError):
    """Raised when a Telegram Mini App initData payload fails validation."""


def validate_init_data(init_data: str, max_age_seconds: int = 86400) -> dict:
    """Validate a Telegram WebApp ``initData`` string and return the embedded user dict
    (id / first_name / last_name / username). Follows Telegram's documented HMAC scheme:
    secret = HMAC_SHA256(key="WebAppData", msg=bot_token); the data-check-string is the
    remaining params sorted and joined by newlines, HMAC'd with that secret.

    Raises InitDataError on any tampering, missing hash, or staleness.
    """
    if not init_data:
        raise InitDataError("empty initData")
    parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise InitDataError("missing hash")

    data_check_string = "\n".join(f"{k}={parsed[k]}" for k in sorted(parsed))
    secret_key = hmac.new(b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256).digest()
    computed = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed, received_hash):
        raise InitDataError("bad signature")

    if max_age_seconds:
        try:
            auth_date = int(parsed.get("auth_date", "0"))
        except ValueError:
            auth_date = 0
        if auth_date <= 0 or (time.time() - auth_date) > max_age_seconds:
            raise InitDataError("stale initData")

    try:
        user = json.loads(parsed.get("user", "{}"))
    except json.JSONDecodeError as exc:
        raise InitDataError("bad user payload") from exc
    if not isinstance(user, dict) or "id" not in user:
        raise InitDataError("no user")
    return user


def decode_jwt(token: str) -> int:
    """Return the subject (telegram_id). Role is re-resolved server-side per request,
    so the token's role claim is informational only."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise ValueError("invalid token") from exc
