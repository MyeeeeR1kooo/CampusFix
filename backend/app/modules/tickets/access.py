"""Ticket read visibility, independent of authentication and state actions.

Callers must obtain the current actor from Auth, not client-submitted identity.
These helpers neither query models nor authorize Workflow/Comments mutations.
"""

from typing import Any, Iterable, List, Mapping, Optional

from app.core.errors import AppError, ErrorCode


def _is_valid_id(value: object) -> bool:
    # bool is an int subclass and must not alias a real user's ID.
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def ticket_is_visible(
    *,
    actor_id: int,
    actor_role: str,
    reporter_id: int,
    current_assignee_id: Optional[int],
) -> bool:
    """Apply P0 resource ownership only; ticket status does not restrict reads.

    A current Technician can therefore read their closed-ticket history.
    Unknown roles and malformed actor IDs fail closed. Ownership comparisons
    only accept positive integer IDs, never coercing strings, floats or bools.
    """
    if not _is_valid_id(actor_id):
        return False
    if actor_role == "ADMIN":
        return True
    if actor_role == "REPORTER":
        return _is_valid_id(reporter_id) and actor_id == reporter_id
    if actor_role == "TECHNICIAN":
        return _is_valid_id(current_assignee_id) and actor_id == current_assignee_id
    return False


def require_ticket_visible(
    *,
    actor_id: int,
    actor_role: str,
    reporter_id: int,
    current_assignee_id: Optional[int],
) -> None:
    """Use the same error as a missing ticket, without disclosing its existence."""
    if not ticket_is_visible(
        actor_id=actor_id,
        actor_role=actor_role,
        reporter_id=reporter_id,
        current_assignee_id=current_assignee_id,
    ):
        raise AppError(ErrorCode.NOT_FOUND, 404, "Resource not found.")


def require_admin_assignee_filter(
    *, actor_role: str, current_assignee_id: Optional[int]
) -> None:
    """Authorize the optional Admin-only list filter, not general list access.

    The request schema validates the filter ID; Auth and resource-scoped queries
    must still enforce identity and role when the filter is absent.
    """
    if current_assignee_id is not None and actor_role != "ADMIN":
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")


def visible_timeline_entries(
    *,
    actor_id: int,
    actor_role: str,
    reporter_id: int,
    current_assignee_id: Optional[int],
    entries: Iterable[Mapping[str, Any]],
) -> List[Mapping[str, Any]]:
    """Authorize the ticket before consuming entries, then filter visibility.

    Unknown/missing visibility is not returned, even to Admin. Input order and
    records are unchanged; query/serialization code owns sorting and the public
    field whitelist. This helper does not sanitize raw records or compute
    allowed_actions, and must not replace that final response serialization.
    """
    require_ticket_visible(
        actor_id=actor_id,
        actor_role=actor_role,
        reporter_id=reporter_id,
        current_assignee_id=current_assignee_id,
    )
    return [
        entry
        for entry in entries
        if entry.get("visibility") == "PUBLIC"
        or (actor_role == "ADMIN" and entry.get("visibility") == "ADMIN_ONLY")
    ]
