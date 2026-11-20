"""Visibility-scoped database reads and approved literal search for Issue #51.

No HTTP routes, Workflow policy substitutes or writes live here. Callers must
obtain actor from Auth's get_current_user, not request data. HTTP adapters add
the real Workflow projection to these internal DTOs. The caller owns its
Session/transaction.
"""

from sqlalchemy import or_, select, true
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError, ErrorCode
from app.models import Location, Ticket, User
from app.modules.tickets.access import require_admin_assignee_filter
from app.modules.tickets.pagination import (
    CursorPosition, decode_ticket_cursor, encode_ticket_cursor,
    ticket_seek_predicate,
)
from app.modules.tickets.read_models import TicketListReadData, TicketReadData, UserReadData
from app.modules.tickets.schemas import TicketListFilters


def _require_read_actor(actor: User) -> None:
    """Fail closed for invalid internal callers; this does not authenticate."""
    actor_id = getattr(actor, "id", None)
    actor_role = getattr(actor, "role", None)
    if (
        type(actor_id) is not int or not 1 <= actor_id <= 2**63 - 1
        or not isinstance(actor_role, str)
        or actor_role not in {"REPORTER", "TECHNICIAN", "ADMIN"}
        or getattr(actor, "active", None) is not True
    ):
        raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")


def _visibility_condition(actor: User):
    if actor.role == "REPORTER":
        return Ticket.reporter_id == actor.id
    if actor.role == "TECHNICIAN":
        # P0 keeps current_assignee_id on CLOSED tickets; no state filter here.
        return Ticket.current_assignee_id == actor.id
    if actor.role == "ADMIN":
        return true()
    # Never allow a future caller to accidentally widen an unknown role.
    raise AppError(ErrorCode.UNAUTHORIZED, 401, "Authentication failed.")


def _ticket_statement():
    """Only ticket scalar fields and the three public user-summary fields."""
    reporter = aliased(User, name="ticket_reporter")
    assignee = aliased(User, name="ticket_assignee")
    return (
        select(
            Ticket.id, Ticket.code, Ticket.reporter_id,
            reporter.name.label("reporter_name"), reporter.role.label("reporter_role"),
            Ticket.location_id, Ticket.location_label_snapshot, Ticket.title,
            Ticket.category, Ticket.priority, Ticket.status, Ticket.current_assignee_id,
            assignee.name.label("assignee_name"), assignee.role.label("assignee_role"),
            Ticket.version, Ticket.created_at, Ticket.updated_at, Ticket.closed_at,
        )
        .select_from(Ticket)
        .join(reporter, reporter.id == Ticket.reporter_id)
        .outerjoin(assignee, assignee.id == Ticket.current_assignee_id)
    )


def _ticket_from_row(row) -> TicketReadData:
    values = getattr(row, "_mapping", row)
    assignee = None
    if values["current_assignee_id"] is not None:
        assignee = UserReadData(
            id=values["current_assignee_id"], name=values["assignee_name"],
            role=values["assignee_role"],
        )
    return TicketReadData(
        id=values["id"], code=values["code"],
        reporter=UserReadData(
            id=values["reporter_id"], name=values["reporter_name"], role=values["reporter_role"],
        ),
        location_id=values["location_id"],
        location_label_snapshot=values["location_label_snapshot"],
        title=values["title"], category=values["category"], priority=values["priority"],
        status=values["status"], current_assignee=assignee, version=values["version"],
        created_at=values["created_at"], updated_at=values["updated_at"],
        closed_at=values["closed_at"],
    )


def list_ticket_reads(
    db: Session, *, actor: User, filters: TicketListFilters, secret_key: str,
) -> TicketListReadData:
    """Read a visibility-scoped page with literal, case-insensitive search.

    This seam accepts validated fields, not raw HTTP inputs. The approved q
    matches a substring of code OR title; SQL wildcard characters are literal.
    No operation flushes, commits or rolls back the caller's pending work.
    """
    with db.no_autoflush:
        _require_read_actor(actor)
        # Revalidate even model_construct/model_copy bypasses: the query must
        # never exceed the approved page-size bound or accept unparsed fields.
        filters = TicketListFilters.model_validate(filters.model_dump())
        require_admin_assignee_filter(
            actor_role=actor.role, current_assignee_id=filters.current_assignee_id,
        )
        if not isinstance(secret_key, str) or not secret_key:
            raise ValueError("An explicit cursor-signing secret is required.")

        scope = filters.model_dump(exclude={"cursor", "limit"}, exclude_none=True)
        statement = _ticket_statement().where(_visibility_condition(actor))
        for name in ("status", "category", "priority", "current_assignee_id"):
            value = getattr(filters, name)
            if value is not None:
                statement = statement.where(getattr(Ticket, name) == value)
        if filters.building is not None:
            # Query today's related building, including disabled locations;
            # display always uses the already-saved snapshot, never this label.
            statement = statement.join(Location, Location.id == Ticket.location_id).where(
                Location.building == filters.building,
            )
        if filters.created_from is not None:
            statement = statement.where(Ticket.created_at >= filters.created_from)
        if filters.created_before is not None:
            statement = statement.where(Ticket.created_at < filters.created_before)
        if filters.q is not None:
            statement = statement.where(or_(
                Ticket.code.icontains(filters.q, autoescape=True),
                Ticket.title.icontains(filters.q, autoescape=True),
            ))
        if filters.cursor is not None:
            position = decode_ticket_cursor(
                filters.cursor, secret_key=secret_key, user_id=actor.id,
                role=actor.role, filters=scope,
            )
            statement = statement.where(ticket_seek_predicate(Ticket.created_at, Ticket.id, position))
        statement = statement.order_by(Ticket.created_at.desc(), Ticket.id.desc()).limit(filters.limit + 1)
        rows = db.execute(statement).all()
        items = tuple(_ticket_from_row(row) for row in rows[:filters.limit])
        next_cursor = None
        if len(rows) > filters.limit:
            last = items[-1]
            next_cursor = encode_ticket_cursor(
                CursorPosition(last.created_at, last.id), secret_key=secret_key,
                user_id=actor.id, role=actor.role, filters=scope,
            )
        return TicketListReadData(items=items, next_cursor=next_cursor)
