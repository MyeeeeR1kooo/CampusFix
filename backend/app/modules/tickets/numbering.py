"""Format a ticket number from an identity and an explicit calendar date."""

from datetime import date, datetime


def format_ticket_code(*, ticket_id: int, calendar_date: date) -> str:
    """Use an already allocated PostgreSQL identity, not a per-day counter.

    The creation service must supply the frozen Asia/Shanghai creation date.
    This helper intentionally does not accept a timestamp,
    consult the clock, allocate an ID, or write any database rows.
    """

    if type(ticket_id) is not int or not 1 <= ticket_id <= 2**63 - 1:
        raise ValueError("ticket_id must be a positive PostgreSQL bigint identity")
    if not isinstance(calendar_date, date) or isinstance(calendar_date, datetime):
        raise ValueError("calendar_date must be an explicitly selected date")
    day = f"{calendar_date.year:04d}{calendar_date.month:02d}{calendar_date.day:02d}"
    return f"CF-{day}-{ticket_id:06d}"
