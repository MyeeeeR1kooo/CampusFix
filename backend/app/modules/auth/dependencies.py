"""Authentication dependencies shared by protected API routes."""

from datetime import datetime, timezone

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.core.security import get_session_token, hash_session_token
from app.models import Session as AuthSession, User


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = get_session_token(request)
    if not token:
        raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")

    user = db.scalar(
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(
            AuthSession.token_hash == hash_session_token(token),
            AuthSession.expires_at > datetime.now(timezone.utc),
            User.active.is_(True),
        )
    )
    if user is None:
        raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "ADMIN":
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")
    return user
