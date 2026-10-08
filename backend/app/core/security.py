import hashlib
import secrets
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Request, Response

from app.core.config import Settings


SESSION_COOKIE_NAME = "campusfix_session"


password_hasher = PasswordHasher()


class OriginError(ValueError):
    """Raised when a state-changing request has an untrusted Origin."""


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        return False


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_session_token(request: Request) -> Optional[str]:
    return request.cookies.get(SESSION_COOKIE_NAME)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=settings.session_lifetime_seconds,
        httponly=True,
        samesite="lax",
        secure=bool(settings.secure_cookies),
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        httponly=True,
        samesite="lax",
        secure=bool(settings.secure_cookies),
        path="/",
    )


def require_same_origin(request: Request, settings: Settings) -> None:
    if request.method.upper() in {"GET", "HEAD", "OPTIONS"}:
        return
    origin = request.headers.get("origin")
    if not origin or origin not in settings.allowed_origins:
        raise OriginError("Origin is not allowed for this request")
