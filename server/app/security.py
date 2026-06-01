import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

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


def decode_jwt(token: str) -> int:
    """Return the subject (telegram_id). Role is re-resolved server-side per request,
    so the token's role claim is informational only."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return int(payload["sub"])
    except (JWTError, KeyError, ValueError) as exc:
        raise ValueError("invalid token") from exc
