from datetime import date
from typing import List, Literal

from pydantic import BaseModel, ConfigDict, Field


TicketStatus = Literal[
    "SUBMITTED", "PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS",
    "PENDING_CONFIRMATION", "CLOSED", "REJECTED", "CANCELLED",
]
TicketCategory = Literal[
    "LIGHTING_ELECTRICAL", "DOORS_WINDOWS_LOCKS", "FURNITURE", "HVAC",
    "WATER_SANITARY", "OTHER_FACILITY",
]


class StatusCount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: TicketStatus
    count: int = Field(ge=0)


class CategoryCount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    category: TicketCategory
    count: int = Field(ge=0)


class BuildingCount(BaseModel):
    model_config = ConfigDict(extra="forbid")
    building: str
    count: int = Field(ge=0)


class DailyTrend(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    created_count: int = Field(ge=0)
    closed_count: int = Field(ge=0)


class AnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    by_status: List[StatusCount]
    by_category: List[CategoryCount]
    by_building: List[BuildingCount]
    backlog_count: int = Field(ge=0)
    average_close_seconds: float = Field(ge=0)
    daily_trend: List[DailyTrend] = Field(min_length=30, max_length=30)
