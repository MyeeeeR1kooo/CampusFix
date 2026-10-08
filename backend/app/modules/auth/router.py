"""Login and logout routes."""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import AppError, ErrorCode
from app.core.security import (
    clear_session_cookie,
    generate_session_token,
    get_session_token,
    hash_session_token,
    set_session_cookie,
    verify_password,
)
from app.models import Session as AuthSession, User
from app.modules.auth.dependencies import get_current_user
from app.modules.users.schemas import UserResponse


router = APIRouter(prefix="/api/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: Annotated[str, StringConstraints(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")] = Field(
        json_schema_extra={"format": "email"}
    )
    password: str = Field(min_length=1, json_schema_extra={"writeOnly": True})


@router.post("/login", response_model=UserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.password_hash) or not user.active:
        raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")

    public_user = UserResponse.model_validate(user)
    token = generate_session_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_session_token(token),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.session_lifetime_seconds),
        )
    )
    db.commit()
    set_session_cookie(response, token, settings)
    return public_user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> None:
    token = get_session_token(request)
    db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_session_token(token)))
    db.commit()
    clear_session_cookie(response, settings)
