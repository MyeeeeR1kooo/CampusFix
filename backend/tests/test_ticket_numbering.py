"""Pure number formatting tests, not proof of concurrent database allocation."""

from datetime import date, datetime, timezone

import pytest

from app.modules.tickets.numbering import format_ticket_code


@pytest.mark.parametrize(
    ("ticket_id", "suffix"),
    [(1, "000001"), (42, "000042"), (999999, "999999"), (1000000, "1000000"),
     (2**63 - 1, "9223372036854775807")],
)
def test_uses_identity_and_at_least_six_suffix_digits(ticket_id, suffix):
    assert format_ticket_code(ticket_id=ticket_id, calendar_date=date(2026, 10, 4)) == (
        f"CF-20261004-{suffix}"
    )


def test_explicit_date_is_not_replaced_by_a_clock_or_timezone():
    assert format_ticket_code(ticket_id=42, calendar_date=date(2024, 2, 29)) == (
        "CF-20240229-000042"
    )
    assert format_ticket_code(ticket_id=42, calendar_date=date(1, 1, 1)) == (
        "CF-00010101-000042"
    )


@pytest.mark.parametrize("ticket_id", [0, -1, True, False, 1.0, "1", None, 2**63])
def test_rejects_values_that_cannot_be_identity_ids(ticket_id):
    with pytest.raises(ValueError):
        format_ticket_code(ticket_id=ticket_id, calendar_date=date(2026, 10, 4))


@pytest.mark.parametrize(
    "calendar_date", [None, "2026-10-04", datetime(2026, 10, 4),
                      datetime(2026, 10, 4, tzinfo=timezone.utc)],
)
def test_requires_date_without_guessing_timestamp_timezone(calendar_date):
    with pytest.raises(ValueError):
        format_ticket_code(ticket_id=1, calendar_date=calendar_date)


def test_distinct_database_ids_have_distinct_numbers_for_same_date():
    codes = {
        format_ticket_code(ticket_id=identity, calendar_date=date(2026, 10, 4))
        for identity in range(1, 1001)
    }
    assert len(codes) == 1000
