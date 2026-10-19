"""Current-user and administrator account routes."""

from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.models import User
from app.modules.auth.dependencies import get_current_user, require_admin
from app.modules.auth.service import revoke_user_sessions
from app.modules.users.cursor import decode_cursor, encode_cursor
from app.modules.users.schemas import UserActiveRequest, UserListResponse, UserResponse


router = APIRouter(prefix="/api", tags=["Users"])


@router.get("/me", response_model=UserResponse)
def current_user(user: User = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


@router.get("/admin/users", response_model=UserListResponse)
def list_users(
    cursor: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    role: Optional[Literal["REPORTER", "TECHNICIAN"]] = None,
    active: Optional[bool] = None,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserListResponse:
    statement = select(User).where(User.role.in_(("REPORTER", "TECHNICIAN")))
    if role is not None:
        statement = statement.where(User.role == role)
    if active is not None:
        statement = statement.where(User.active.is_(active))
    if cursor is not None:
        created_at, user_id = decode_cursor(cursor, role, active, settings.secret_key)
        statement = statement.where(tuple_(User.created_at, User.id) < (created_at, user_id))
    rows = db.scalars(statement.order_by(User.created_at.desc(), User.id.desc()).limit(limit + 1)).all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_cursor(last.created_at, last.id, role, active, settings.secret_key)
    return UserListResponse(
        items=[UserResponse.model_validate(user) for user in rows[:limit]],
        next_cursor=next_cursor,
    )


@router.patch("/admin/users/{id}/active", response_model=UserResponse)
def set_user_active(
    payload: UserActiveRequest,
    id: int = Path(ge=1),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserResponse:
    user = db.get(User, id)
    if user is None:
        raise AppError(ErrorCode.NOT_FOUND, 404, "Resource not found.")
    if user.role == "ADMIN":
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")
    if user.active != payload.active:
        user.active = payload.active
        user.updated_at = datetime.now(timezone.utc)
        if not payload.active:
            revoke_user_sessions(db, user.id)
        db.commit()
    return UserResponse.model_validate(user)
