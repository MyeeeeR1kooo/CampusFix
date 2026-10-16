"""Public account response schemas."""

from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, StrictBool, field_validator


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: int
    name: str
    email: str
    role: str
    active: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def use_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)


class UserListResponse(BaseModel):
    items: List[UserResponse]
    next_cursor: Optional[str]


class UserActiveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active: StrictBool
