"""Frozen ticket response shapes shared by the creation and read adapters.

Workflow must supply the three projection fields after Tickets has established
visibility. These models validate data; they never compute policy, authenticate,
write state, register endpoints or make attachment download URLs usable.
"""

from datetime import datetime
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator

from app.modules.tickets.read_models import (
    AssignmentReadData,
    AttachmentReadData,
    CommentReadData,
    EventReadData,
    TicketReadData,
    UserReadData,
)


PositiveInteger = Annotated[int, Field(strict=True, gt=0)]
TicketAction = Literal[
    "REVIEW", "ASSIGN", "START", "RESOLVE", "CONFIRM", "REWORK", "CANCEL",
    "COMMENT_PUBLIC", "COMMENT_ADMIN_ONLY",
]


def _timestamp_input(value):
    # Server-side aware datetimes are normalized by the inherited UTC validator.
    # Serialized contract values must already use UTC Z; epochs are not strings.
    if isinstance(value, datetime):
        if value.utcoffset() is not None:
            return value
    elif isinstance(value, str) and value.endswith("Z"):
        return value
    raise ValueError("Expected an aware datetime or an ISO 8601 UTC Z string.")


ResponseTimestamp = Annotated[datetime, BeforeValidator(_timestamp_input)]


class _UserSummary(UserReadData):
    id: PositiveInteger


class _Attachment(AttachmentReadData):
    id: PositiveInteger
    ticket_id: PositiveInteger
    uploader: _UserSummary
    size: Annotated[int, Field(strict=True, gt=0, le=5242880)]
    created_at: ResponseTimestamp
    download_url: Annotated[str, Field(pattern=r"^/api/attachments/[1-9][0-9]*$")]


class _Assignment(AssignmentReadData):
    id: PositiveInteger
    ticket_id: PositiveInteger
    technician: _UserSummary
    assigned_by: _UserSummary
    assigned_at: ResponseTimestamp
    ended_at: None  # P0 has no reassignment, including after closure.


class _Event(EventReadData):
    kind: Literal["EVENT"]
    id: PositiveInteger
    ticket_id: PositiveInteger
    actor: _UserSummary
    type: Literal[
        "TICKET_SUBMITTED", "TICKET_APPROVED", "TICKET_REJECTED", "TICKET_CANCELLED",
        "TICKET_ASSIGNED", "WORK_STARTED", "RESOLUTION_SUBMITTED", "TICKET_CLOSED",
        "REWORK_REQUESTED",
    ]
    created_at: ResponseTimestamp


class _Comment(CommentReadData):
    kind: Literal["COMMENT"]
    id: PositiveInteger
    ticket_id: PositiveInteger
    author: _UserSummary
    body: Annotated[str, Field(min_length=1, max_length=2000)]
    created_at: ResponseTimestamp


class TicketSummaryResponse(TicketReadData):
    id: PositiveInteger
    code: Annotated[str, Field(pattern=r"^CF-[0-9]{8}-[0-9]{6,}$")]
    reporter: _UserSummary
    location_id: PositiveInteger
    title: Annotated[str, Field(min_length=1, max_length=120)]
    current_assignee: Optional[_UserSummary]
    version: PositiveInteger
    created_at: ResponseTimestamp
    updated_at: ResponseTimestamp
    closed_at: Optional[ResponseTimestamp]
    current_responsible_role: Optional[Literal["REPORTER", "TECHNICIAN", "ADMIN"]]
    next_action: Optional[Literal["REVIEW", "ASSIGN", "START", "RESOLVE", "CONFIRM_OR_REWORK"]]
    allowed_actions: tuple[TicketAction, ...]

    @field_validator("allowed_actions")
    @classmethod
    def require_unique_actions(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("Allowed actions must be unique.")
        return value

    @model_validator(mode="after")
    def validate_frozen_state_fields(self):
        # Structural invariants from TicketFields.allOf, not actor policy.
        assigned = self.status in {"ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED"}
        if self.status == "PENDING_ASSIGNMENT" or assigned:
            if self.priority is None:
                raise ValueError("Reviewed tickets require a priority.")
        if assigned:
            if self.current_assignee is None or self.current_assignee.role != "TECHNICIAN":
                raise ValueError("Assigned tickets require a technician.")
        elif self.current_assignee is not None:
            raise ValueError("Unassigned tickets cannot have a current assignee.")
        if (self.status == "CLOSED") != (self.closed_at is not None):
            raise ValueError("Only CLOSED tickets have a closure timestamp.")
        if self.status in {"CLOSED", "REJECTED", "CANCELLED"} and (
            self.current_responsible_role is not None
            or self.next_action is not None or self.allowed_actions
        ):
            raise ValueError("Terminal tickets have no responsibility or actions.")
        return self


class TicketDetailResponse(TicketSummaryResponse):
    description: Annotated[str, Field(min_length=1, max_length=4000)]
    report_photos: Annotated[tuple[_Attachment, ...], Field(max_length=5)]
    resolution_photos: Annotated[tuple[_Attachment, ...], Field(max_length=5)]
    assignments: tuple[_Assignment, ...]
    timeline: tuple[Annotated[Union[_Event, _Comment], Field(discriminator="kind")], ...]


class TicketListResponse(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    items: tuple[TicketSummaryResponse, ...]
    next_cursor: Optional[str]
