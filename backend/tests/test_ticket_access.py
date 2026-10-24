"""P0 section 3.1/5.4 and #51: read access, not Auth or Workflow evidence."""

from copy import deepcopy
from types import MappingProxyType

import pytest

from app.core.errors import AppError
from app.modules.tickets.access import (
    require_admin_assignee_filter,
    require_ticket_visible,
    ticket_is_visible,
    visible_timeline_entries,
)


@pytest.mark.parametrize(
    "actor_role,actor_id,reporter_id,current_assignee_id,expected",
    [
        ("REPORTER", 1, 1, 2, True),
        ("REPORTER", 3, 1, 3, False),
        ("REPORTER", 1, 1, None, True),
        ("TECHNICIAN", 2, 1, 2, True),
        ("TECHNICIAN", 1, 1, 2, False),
        ("TECHNICIAN", 2, 1, None, False),
        ("TECHNICIAN", 3, 1, 2, False),
        ("ADMIN", 3, 1, 2, True),
        ("ADMIN", 3, 1, None, True),
        ("UNKNOWN", 1, 1, 1, False),
        ("reporter", 1, 1, 1, False),
        (None, 1, 1, 1, False),
    ],
)
def test_read_visibility_matches_role_and_resource_ownership(
    actor_role, actor_id, reporter_id, current_assignee_id, expected
):
    assert ticket_is_visible(
        actor_id=actor_id,
        actor_role=actor_role,
        reporter_id=reporter_id,
        current_assignee_id=current_assignee_id,
    ) is expected


@pytest.mark.parametrize("actor_role", ["REPORTER", "TECHNICIAN", "ADMIN"])
@pytest.mark.parametrize("actor_id", [None, True, False, 0, -1, "1", 1.0])
def test_malformed_actor_id_fails_closed_even_for_admin(actor_role, actor_id):
    assert not ticket_is_visible(
        actor_id=actor_id,
        actor_role=actor_role,
        reporter_id=1,
        current_assignee_id=1,
    )


@pytest.mark.parametrize("actor_role", ["REPORTER", "TECHNICIAN"])
@pytest.mark.parametrize("owner_id", [None, True, False, 0, -1, "1", 1.0])
def test_malformed_ownership_id_cannot_alias_the_actor(actor_role, owner_id):
    assert not ticket_is_visible(
        actor_id=1,
        actor_role=actor_role,
        reporter_id=owner_id if actor_role == "REPORTER" else 2,
        current_assignee_id=owner_id if actor_role == "TECHNICIAN" else 2,
    )


def test_current_technician_can_read_closed_history_without_status_authorization():
    closed_ticket = {"status": "CLOSED", "reporter_id": 1, "current_assignee_id": 2}
    require_ticket_visible(
        actor_id=2,
        actor_role="TECHNICIAN",
        reporter_id=closed_ticket["reporter_id"],
        current_assignee_id=closed_ticket["current_assignee_id"],
    )
    assert closed_ticket["status"] == "CLOSED"


@pytest.mark.parametrize("actor_role", ["REPORTER", "TECHNICIAN", "UNKNOWN"])
def test_invisible_ticket_uses_the_generic_not_found_error(actor_role):
    with pytest.raises(AppError) as caught:
        require_ticket_visible(
            actor_id=3, actor_role=actor_role, reporter_id=1, current_assignee_id=2
        )
    assert caught.value.code == "NOT_FOUND"
    assert caught.value.status_code == 404
    assert caught.value.message == "Resource not found."
    assert caught.value.field_errors == []


@pytest.mark.parametrize("actor_role", ["REPORTER", "TECHNICIAN", "UNKNOWN", None])
@pytest.mark.parametrize("current_assignee_id", [1, 0, False])
def test_present_assignee_filter_is_forbidden_to_non_admin(
    actor_role, current_assignee_id
):
    with pytest.raises(AppError) as caught:
        require_admin_assignee_filter(
            actor_role=actor_role, current_assignee_id=current_assignee_id
        )
    assert caught.value.code == "FORBIDDEN"
    assert caught.value.status_code == 403
    assert caught.value.message == "This action is not allowed."


def test_admin_may_use_valid_assignee_filter():
    require_admin_assignee_filter(actor_role="ADMIN", current_assignee_id=2)


@pytest.mark.parametrize("actor_role", ["REPORTER", "TECHNICIAN", "ADMIN"])
def test_no_assignee_filter_does_not_add_an_admin_only_requirement(actor_role):
    require_admin_assignee_filter(actor_role=actor_role, current_assignee_id=None)


@pytest.mark.parametrize(
    "actor_role,actor_id,expected_ids",
    [("REPORTER", 1, [4, 2]), ("TECHNICIAN", 2, [4, 2]), ("ADMIN", 3, [4, 3, 2])],
)
def test_timeline_filters_internal_and_unknown_visibility_without_mutating_input(
    actor_role, actor_id, expected_ids
):
    entries = [
        {"id": 4, "kind": "EVENT", "visibility": "PUBLIC", "note": "created"},
        {"id": 3, "kind": "COMMENT", "visibility": "ADMIN_ONLY", "body": "internal"},
        {"id": 2, "kind": "COMMENT", "visibility": "PUBLIC", "body": "public"},
        {"id": 1, "kind": "COMMENT", "visibility": "UNKNOWN", "body": "unknown"},
        {"id": 0, "kind": "COMMENT", "body": "missing visibility"},
        {"id": 5, "kind": "COMMENT", "visibility": None, "body": "null visibility"},
    ]
    original = deepcopy(entries)
    visible = visible_timeline_entries(
        actor_id=actor_id,
        actor_role=actor_role,
        reporter_id=1,
        current_assignee_id=2,
        entries=entries,
    )
    assert [entry["id"] for entry in visible] == expected_ids
    assert entries == original
    assert visible is not entries
    assert visible[0] is entries[0]


@pytest.mark.parametrize("actor_role,actor_id", [("REPORTER", 2), ("UNKNOWN", 1), ("ADMIN", True)])
def test_invisible_ticket_does_not_consume_lazy_timeline(actor_role, actor_id):
    class UnreadableEntries:
        def __iter__(self):
            pytest.fail("Timeline must not be read before ticket authorization")

    with pytest.raises(AppError) as caught:
        visible_timeline_entries(
            actor_id=actor_id,
            actor_role=actor_role,
            reporter_id=1,
            current_assignee_id=None,
            entries=UnreadableEntries(),
        )
    assert caught.value.code == "NOT_FOUND"
    assert caught.value.status_code == 404


def test_timeline_accepts_read_only_mappings_and_single_pass_iterables():
    entries = (
        MappingProxyType({"id": 1, "visibility": "PUBLIC"}),
        MappingProxyType({"id": 2, "visibility": "ADMIN_ONLY"}),
    )
    result = visible_timeline_entries(
        actor_id=1,
        actor_role="REPORTER",
        reporter_id=1,
        current_assignee_id=None,
        entries=iter(entries),
    )
    assert result == [entries[0]]


def test_empty_visible_timeline_returns_an_empty_list():
    assert visible_timeline_entries(
        actor_id=1,
        actor_role="REPORTER",
        reporter_id=1,
        current_assignee_id=None,
        entries=[],
    ) == []
