"""Combine prepared ticket helpers, without pretending to call a real API."""

from datetime import date, datetime, timezone

import pytest

from app.core.errors import AppError
from app.modules.tickets.access import require_ticket_visible, visible_timeline_entries
from app.modules.tickets.numbering import format_ticket_code
from app.modules.tickets.pagination import (
    CursorPosition, decode_ticket_cursor, encode_ticket_cursor,
)
from app.modules.tickets.schemas import CreateTicketFields, TicketListFilters


def filter_scope(fields):
    # The same rule is required in future query code: bind all filters but not
    # the current cursor or page size; do not stringify normalized datetime.
    return fields.model_dump(exclude={"cursor", "limit"}, exclude_none=True)


def test_validated_list_filters_can_be_bound_to_a_principal_cursor():
    fields = TicketListFilters(
        status="SUBMITTED", category="FURNITURE", priority="HIGH", building="演示楼",
        created_from="2026-10-01T00:00:00Z", created_before="2026-10-05T00:00:00Z",
        q="原样 关键词", current_assignee_id="5", limit="20",
    )
    position = CursorPosition(datetime(2026, 10, 4, tzinfo=timezone.utc), 42)
    context = {"secret_key": "isolated-helper-test-secret", "user_id": 3, "role": "ADMIN"}
    cursor = encode_ticket_cursor(position, filters=filter_scope(fields), **context)
    next_request = TicketListFilters(**{**fields.model_dump(), "cursor": cursor, "limit": 100})
    assert decode_ticket_cursor(cursor, filters=filter_scope(next_request), **context) == position
    assert filter_scope(next_request)["q"] == "原样 关键词"


@pytest.mark.parametrize("changes", [{"user_id": 4}, {"role": "ADMIN"}])
def test_combined_cursor_does_not_transfer_to_another_principal(changes):
    fields = TicketListFilters(status="SUBMITTED")
    context = {"secret_key": "isolated-helper-test-secret", "user_id": 1, "role": "REPORTER"}
    position = CursorPosition(datetime(2026, 10, 4, tzinfo=timezone.utc), 42)
    cursor = encode_ticket_cursor(position, filters=filter_scope(fields), **context)
    with pytest.raises(AppError) as caught:
        decode_ticket_cursor(cursor, filters=filter_scope(fields), **{**context, **changes})
    assert (caught.value.status_code, caught.value.code) == (400, "VALIDATION_ERROR")


def test_creation_fields_and_number_format_do_not_allocate_or_initialize_a_ticket():
    fields = CreateTicketFields(
        title="演示桌椅松动", description="演示说明", category="FURNITURE", location_id="7",
    )
    allocated_identity = 42  # Supplied fixture, not a database allocation test.
    code = format_ticket_code(ticket_id=allocated_identity, calendar_date=date(2026, 10, 4))
    assert fields.location_id == 7
    assert code == "CF-20261004-000042"
    assert "status" not in fields.model_dump()


def test_read_authorization_and_internal_filtering_can_be_composed():
    ownership = {"actor_id": 1, "actor_role": "REPORTER", "reporter_id": 1,
                 "current_assignee_id": None}
    require_ticket_visible(**ownership)
    entries = [{"id": 1, "visibility": "PUBLIC"}, {"id": 2, "visibility": "ADMIN_ONLY"}]
    assert visible_timeline_entries(entries=entries, **ownership) == [entries[0]]
    with pytest.raises(AppError) as caught:
        visible_timeline_entries(entries=entries, **{**ownership, "actor_id": 2})
    assert (caught.value.status_code, caught.value.code) == (404, "NOT_FOUND")
