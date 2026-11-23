from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Ticket
from app.modules.analytics.service import get_analytics
from test_locations_api import app, settings, signed_in  # noqa: F401
from test_ticket_reads import STAMP, pg_engine, read_data  # noqa: F401


def test_analytics_matches_ticket_rows_and_shanghai_days(read_data):
    with Session(read_data.engine) as db:
        result = get_analytics(db, now=STAMP + timedelta(days=1))

    statuses = {row.status: row.count for row in result.by_status}
    categories = {row.category: row.count for row in result.by_category}
    buildings = {row.building: row.count for row in result.by_building}
    assert statuses["SUBMITTED"] == 2
    assert statuses["ASSIGNED"] == 3
    assert statuses["CLOSED"] == 1
    assert categories["HVAC"] == 4
    assert categories["LIGHTING_ELECTRICAL"] == 3
    assert buildings == {"Current A": 4, "Current B": 4}
    assert result.backlog_count == 7
    assert result.average_close_seconds == 600
    assert len(result.daily_trend) == 30
    assert result.daily_trend[-1].date.isoformat() == "2026-10-13"
    by_day = {row.date.isoformat(): row for row in result.daily_trend}
    assert by_day["2026-10-11"].created_count == 1
    assert by_day["2026-10-12"].created_count == 7
    assert by_day["2026-10-12"].closed_count == 1
    assert by_day["2026-10-13"].created_count == 0
    assert by_day["2026-10-13"].closed_count == 0


def test_shanghai_midnight_and_waiting_for_confirmation_count_in_close_time(read_data):
    with Session(read_data.engine) as db, db.begin():
        db.execute(update(Ticket).where(Ticket.id == read_data.ids[0]).values(
            created_at=STAMP + timedelta(hours=12, minutes=59, seconds=59),
        ))
        db.execute(update(Ticket).where(Ticket.id == read_data.ids[1]).values(
            created_at=STAMP + timedelta(hours=13),
        ))
        # Reporter confirmation two days after creation is part of total close time.
        db.execute(update(Ticket).where(Ticket.id == read_data.ids[4]).values(
            closed_at=STAMP + timedelta(days=2),
        ))

    with Session(read_data.engine) as db:
        result = get_analytics(db, now=STAMP + timedelta(days=2))

    by_day = {row.date.isoformat(): row for row in result.daily_trend}
    assert by_day["2026-10-11"].created_count == 0
    assert by_day["2026-10-12"].created_count == 7
    assert by_day["2026-10-13"].created_count == 1
    assert by_day["2026-10-12"].closed_count == 0
    assert by_day["2026-10-14"].closed_count == 1
    assert result.average_close_seconds == 2 * 24 * 60 * 60


def test_analytics_requires_admin_and_has_stable_empty_response(app):
    assert TestClient(app).get("/api/admin/analytics").status_code == 401
    assert signed_in(app, "REPORTER").get("/api/admin/analytics").status_code == 403
    response = signed_in(app).get("/api/admin/analytics")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["backlog_count"] == 0
    assert result["average_close_seconds"] == 0
    assert result["by_building"] == []
    assert len(result["daily_trend"]) == 30
    assert all(day["created_count"] == day["closed_count"] == 0 for day in result["daily_trend"])
