"""Location schemas implementing the frozen API, without name normalization."""

from datetime import datetime, timezone
from typing import Annotated, Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator, model_validator


LocationText = Annotated[StrictStr, Field(min_length=1)]


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: int
    building: str
    floor: str
    room_or_area: str
    active: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("created_at", "updated_at")
    @classmethod
    def use_utc(cls, value: datetime) -> datetime:
        return value.astimezone(timezone.utc)


class LocationListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: List[LocationResponse]
    next_cursor: Optional[str]


class CreateLocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building: LocationText
    floor: LocationText
    room_or_area: LocationText
    active: StrictBool = True


class UpdateLocationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"minProperties": 1})

    # An omitted field is untouched; an explicit null fails its non-null type.
    # Defaults are deliberately not validated or included in exclude_unset dumps.
    building: LocationText = Field(default=None)
    floor: LocationText = Field(default=None)
    room_or_area: LocationText = Field(default=None)
    active: StrictBool = Field(default=None)

    @model_validator(mode="before")
    @classmethod
    def require_change(cls, value: Any) -> Any:
        if isinstance(value, dict) and not value:
            raise ValueError("At least one location field is required.")
        return value
