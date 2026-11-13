"""Request schemas for the four Update 2 state actions."""

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictStr


Version = Annotated[int, Field(strict=True, ge=1)]
Id = Annotated[int, Field(strict=True, ge=1, le=2**63 - 1)]
Category = Literal[
    "LIGHTING_ELECTRICAL", "DOORS_WINDOWS_LOCKS", "FURNITURE",
    "HVAC", "WATER_SANITARY", "OTHER_FACILITY",
]
Priority = Literal["LOW", "MEDIUM", "HIGH"]


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: Version


class ApproveRequest(ActionRequest):
    decision: Literal["APPROVE"]
    category: Category
    priority: Priority


class RejectRequest(ActionRequest):
    decision: Literal["REJECT"]
    reason: Annotated[str, Field(strict=True, min_length=1, max_length=2000)]


ReviewRequest = Annotated[Union[ApproveRequest, RejectRequest], Field(discriminator="decision")]


class CancelRequest(ActionRequest):
    reason: Optional[StrictStr] = Field(default=None, max_length=2000)


class AssignRequest(ActionRequest):
    technician_id: Id


class StartRequest(ActionRequest):
    note: Optional[StrictStr] = Field(default=None, max_length=2000)


class ReworkRequest(ActionRequest):
    reason: Annotated[StrictStr, Field(min_length=1, max_length=2000)]
