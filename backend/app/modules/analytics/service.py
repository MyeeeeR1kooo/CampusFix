from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import Date, cast, extract, func, select
from sqlalchemy.orm import Session

from app.models import Location, Ticket
from app.modules.analytics.schemas import (
    AnalyticsResponse, BuildingCount, CategoryCount, DailyTrend, StatusCount,
)


SHANGHAI = ZoneInfo("Asia/Shanghai")
STATUSES = (
    "SUBMITTED", "PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS",
    "PENDING_CONFIRMATION", "CLOSED", "REJECTED", "CANCELLED",
)
CATEGORIES = (
    "LIGHTING_ELECTRICAL", "DOORS_WINDOWS_LOCKS", "FURNITURE", "HVAC",
    "WATER_SANITARY", "OTHER_FACILITY",
)


def _shanghai_date(value: datetime) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(SHANGHAI).date()


def get_analytics(db: Session, *, now: datetime | None = None) -> AnalyticsResponse:
    """Aggregate current ticket data directly from PostgreSQL."""
    status_rows = db.execute(
        select(Ticket.status, func.count(Ticket.id)).group_by(Ticket.status)
    ).all()
    status_counts = {status: int(count) for status, count in status_rows}

    category_rows = db.execute(
        select(Ticket.category, func.count(Ticket.id)).group_by(Ticket.category)
    ).all()
    category_counts = {category: int(count) for category, count in category_rows}

    building_rows = db.execute(
        select(Location.building, func.count(Ticket.id))
        .join(Ticket, Ticket.location_id == Location.id)
        .group_by(Location.building)
        .order_by(Location.building.asc())
    ).all()

    backlog = db.scalar(
        select(func.count(Ticket.id)).where(
            Ticket.status.not_in(("CLOSED", "REJECTED", "CANCELLED"))
        )
    ) or 0
    average = db.scalar(
        select(func.avg(extract("epoch", Ticket.closed_at - Ticket.created_at))).where(
            Ticket.status == "CLOSED", Ticket.closed_at.is_not(None)
        )
    )

    today = _shanghai_date(now or datetime.now(timezone.utc))
    first_day = today - timedelta(days=29)
    # PostgreSQL's timezone() converts stored UTC timestamps before date casting.
    local_created = cast(func.timezone("Asia/Shanghai", Ticket.created_at), Date)
    local_closed = cast(func.timezone("Asia/Shanghai", Ticket.closed_at), Date)
    created_rows = db.execute(
        select(local_created, func.count(Ticket.id))
        .where(local_created >= first_day, local_created <= today)
        .group_by(local_created)
    ).all()
    closed_rows = db.execute(
        select(local_closed, func.count(Ticket.id))
        .where(
            Ticket.status == "CLOSED", Ticket.closed_at.is_not(None),
            local_closed >= first_day, local_closed <= today,
        )
        .group_by(local_closed)
    ).all()
    created_by_day = {day: int(count) for day, count in created_rows}
    closed_by_day = {day: int(count) for day, count in closed_rows}

    return AnalyticsResponse(
        by_status=[StatusCount(status=status, count=status_counts.get(status, 0)) for status in STATUSES],
        by_category=[CategoryCount(category=category, count=category_counts.get(category, 0)) for category in CATEGORIES],
        by_building=[BuildingCount(building=building, count=int(count)) for building, count in building_rows],
        backlog_count=int(backlog),
        average_close_seconds=float(average or 0),
        daily_trend=[
            DailyTrend(
                date=day,
                created_count=created_by_day.get(day, 0),
                closed_count=closed_by_day.get(day, 0),
            )
            for day in (first_day + timedelta(days=offset) for offset in range(30))
        ],
    )
