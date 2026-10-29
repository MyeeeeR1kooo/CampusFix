"""Internal field validation for Issue #51's preparation and read services.

These models do not register routes or implement authorization, queries, cursor
verification, uploads, or workflow actions. The public API contract is frozen
v1.0; these models alone do not implement or complete its business endpoints.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator


# Existing integer/int64 API IDs map to PostgreSQL signed bigint identities.
_MAX_INT64_ID = 2**63 - 1


TicketCategory = Literal[
    "LIGHTING_ELECTRICAL",
    "DOORS_WINDOWS_LOCKS",
    "FURNITURE",
    "HVAC",
    "WATER_SANITARY",
    "OTHER_FACILITY",
]
TicketStatus = Literal[
    "SUBMITTED",
    "PENDING_ASSIGNMENT",
    "ASSIGNED",
    "IN_PROGRESS",
    "PENDING_CONFIRMATION",
    "CLOSED",
    "REJECTED",
    "CANCELLED",
]
TicketPriority = Literal["LOW", "MEDIUM", "HIGH"]


def _integer_input(value: Any) -> Any:
    """Accept native integers or text parsed by the usual query-field parser."""
    if value is not None and (
        isinstance(value, bool) or not isinstance(value, (int, str))
    ):
        raise ValueError("must be an integer")
    return value


class CreateTicketFields(BaseModel):
    """Ticket text fields only; photographs and use-case behavior are separate."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=4000)
    category: TicketCategory
    location_id: int = Field(gt=0, le=_MAX_INT64_ID)

    @field_validator("location_id", mode="before")
    @classmethod
    def validate_location_id_input(cls, value: Any) -> Any:
        return _integer_input(value)


class TicketListFilters(BaseModel):
    """Parsed filter fields, not a query or an authorization decision.

    The seven filter groups include a two-field creation-time range. Database
    integration must apply visibility before pagination, combine filters with
    AND, and restrict current_assignee_id to Admin. This model does none of
    those operations: reads.py implements the approved literal substring
    matching, while pagination.py signs and verifies the cursor.
    """

    model_config = ConfigDict(extra="forbid")

    status: Optional[TicketStatus] = None
    category: Optional[TicketCategory] = None
    priority: Optional[TicketPriority] = None
    building: Optional[str] = Field(default=None, min_length=1, max_length=255)
    created_from: Optional[datetime] = None
    created_before: Optional[datetime] = None
    q: Optional[str] = Field(default=None, min_length=1, max_length=120)
    current_assignee_id: Optional[int] = Field(default=None, gt=0, le=_MAX_INT64_ID)
    cursor: Optional[str] = Field(default=None, min_length=1)
    limit: int = Field(default=20, ge=1, le=100)

    @field_validator("current_assignee_id", "limit", mode="before")
    @classmethod
    def validate_integer_input(cls, value: Any) -> Any:
        return _integer_input(value)

    @field_validator("created_from", "created_before", mode="before")
    @classmethod
    def validate_timestamp_input(cls, value: Any) -> Any:
        if value is None:
            return value
        if isinstance(value, str):
            if not value.endswith("Z"):
                raise ValueError("timestamp text must use ISO 8601 UTC ending in Z")
        elif isinstance(value, datetime):
            if value.utcoffset() != timedelta(0):
                raise ValueError("datetime must be timezone-aware UTC")
        else:
            raise ValueError("timestamp must be ISO 8601 UTC text or a UTC datetime")
        return value

    @field_validator("created_from", "created_before")
    @classmethod
    def normalize_utc_timestamp(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return value
        if value.utcoffset() != timedelta(0):
            raise ValueError("timestamp must be timezone-aware UTC")
        return value.astimezone(timezone.utc)

    @field_validator("created_before")
    @classmethod
    def validate_time_range(cls, value: Optional[datetime], info: ValidationInfo) -> Optional[datetime]:
        created_from = info.data.get("created_from")
        if value is not None and created_from is not None and created_from > value:
            raise ValueError("created_before must not precede created_from")
        return value
