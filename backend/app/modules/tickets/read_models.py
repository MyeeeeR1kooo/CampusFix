"""Immutable, explicitly whitelisted data for #51's independent read seam.

TicketReadData is NOT the public TicketSummary: Workflow's responsibility,
next-action and allowed-actions projection is deliberately absent. An
HTTP adapter must add that real projection and validate the frozen response.
These values contain no ORM objects, account credentials or storage keys.
"""

from datetime import datetime, timezone
from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, field_validator

from app.modules.tickets.schemas import TicketCategory, TicketPriority, TicketStatus


class _ReadData(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    @field_validator(
        "created_at", "updated_at", "closed_at", "assigned_at", "ended_at",
        check_fields=False,
    )
    @classmethod
    def normalize_utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        if value.utcoffset() is None:
            raise ValueError("Read timestamps must be timezone-aware.")
        return value.astimezone(timezone.utc)


class UserReadData(_ReadData):
    id: int
    name: str
    role: Literal["REPORTER", "TECHNICIAN", "ADMIN"]


class TicketReadData(_ReadData):
    id: int
    code: str
    reporter: UserReadData
    location_id: int
    location_label_snapshot: str
    title: str
    category: TicketCategory
    priority: Optional[TicketPriority]
    status: TicketStatus
    current_assignee: Optional[UserReadData]
    version: int
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime]


class TicketListReadData(_ReadData):
    items: tuple[TicketReadData, ...]
    next_cursor: Optional[str]


class AttachmentReadData(_ReadData):
    id: int
    ticket_id: int
    uploader: UserReadData
    original_name: str
    mime: Literal["image/jpeg", "image/png", "image/webp"]
    size: int
    purpose: Literal["REPORT_PHOTO", "RESOLUTION_PHOTO"]
    created_at: datetime
    download_url: str


class AssignmentReadData(_ReadData):
    id: int
    ticket_id: int
    technician: UserReadData
    assigned_by: UserReadData
    assigned_at: datetime
    ended_at: Optional[datetime]
    reason: Optional[str]


class EventReadData(_ReadData):
    kind: Literal["EVENT"] = "EVENT"
    id: int
    ticket_id: int
    actor: UserReadData
    type: str
    from_status: Optional[TicketStatus]
    to_status: TicketStatus
    note: Optional[str]
    visibility: Literal["PUBLIC", "ADMIN_ONLY"]
    created_at: datetime


class CommentReadData(_ReadData):
    kind: Literal["COMMENT"] = "COMMENT"
    id: int
    ticket_id: int
    author: UserReadData
    body: str
    visibility: Literal["PUBLIC", "ADMIN_ONLY"]
    created_at: datetime


class TicketDetailReadData(TicketReadData):
    description: str
    report_photos: tuple[AttachmentReadData, ...]
    resolution_photos: tuple[AttachmentReadData, ...]
    assignments: tuple[AssignmentReadData, ...]
    timeline: tuple[Union[EventReadData, CommentReadData], ...]
