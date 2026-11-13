"""Caller-owned ticket detail reads for Issue #51's independent read seam.

These are internal read data, not the frozen HTTP TicketDetail response:
The HTTP adapter adds Workflow's real responsibility/action projections. Attachment URLs
are metadata only; the Attachments module owns authorization and file access.
No business state, descendant or transaction is written here. The caller
supplies the current actor obtained from Auth.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session, aliased

from app.core.errors import AppError, ErrorCode
from app.models import Assignment, Attachment, Comment, Ticket, TicketEvent, User
from app.modules.tickets.read_models import (
    AssignmentReadData,
    AttachmentReadData,
    CommentReadData,
    EventReadData,
    TicketDetailReadData,
    UserReadData,
)
from app.modules.tickets.reads import (
    _require_read_actor,
    _ticket_from_row,
    _ticket_statement,
    _visibility_condition,
)


def _attachment_reads(db: Session, ticket_id: int) -> tuple[AttachmentReadData, ...]:
    uploader = aliased(User, name="attachment_uploader")
    statement = (
        select(
            Attachment.id,
            Attachment.ticket_id,
            Attachment.original_name,
            Attachment.mime,
            Attachment.size,
            Attachment.purpose,
            Attachment.created_at,
            uploader.id.label("uploader_id"),
            uploader.name.label("uploader_name"),
            uploader.role.label("uploader_role"),
        )
        .join(uploader, uploader.id == Attachment.uploader_id)
        .where(Attachment.ticket_id == ticket_id)
        .order_by(Attachment.created_at.asc(), Attachment.id.asc())
    )
    return tuple(
        AttachmentReadData(
            id=row.id,
            ticket_id=row.ticket_id,
            uploader=UserReadData(
                id=row.uploader_id, name=row.uploader_name, role=row.uploader_role
            ),
            original_name=row.original_name,
            mime=row.mime,
            size=row.size,
            purpose=row.purpose,
            created_at=row.created_at,
            download_url=f"/api/attachments/{row.id}",
        )
        for row in db.execute(statement)
    )


def _assignment_reads(db: Session, ticket_id: int) -> tuple[AssignmentReadData, ...]:
    technician = aliased(User, name="assignment_technician")
    assigned_by = aliased(User, name="assignment_author")
    statement = (
        select(
            Assignment.id,
            Assignment.ticket_id,
            Assignment.assigned_at,
            Assignment.ended_at,
            Assignment.reason,
            technician.id.label("technician_id"),
            technician.name.label("technician_name"),
            technician.role.label("technician_role"),
            assigned_by.id.label("assigned_by_id"),
            assigned_by.name.label("assigned_by_name"),
            assigned_by.role.label("assigned_by_role"),
        )
        .join(technician, technician.id == Assignment.technician_id)
        .join(assigned_by, assigned_by.id == Assignment.assigned_by)
        .where(Assignment.ticket_id == ticket_id)
        .order_by(Assignment.assigned_at.asc(), Assignment.id.asc())
    )
    return tuple(
        AssignmentReadData(
            id=row.id,
            ticket_id=row.ticket_id,
            technician=UserReadData(
                id=row.technician_id,
                name=row.technician_name,
                role=row.technician_role,
            ),
            assigned_by=UserReadData(
                id=row.assigned_by_id,
                name=row.assigned_by_name,
                role=row.assigned_by_role,
            ),
            assigned_at=row.assigned_at,
            ended_at=row.ended_at,
            reason=row.reason,
        )
        for row in db.execute(statement)
    )


def _event_reads(
    db: Session, *, actor: User, ticket_id: int
) -> tuple[EventReadData, ...]:
    event_actor = aliased(User, name="event_actor")
    visible_values = ("PUBLIC", "ADMIN_ONLY") if actor.role == "ADMIN" else ("PUBLIC",)
    statement = (
        select(
            TicketEvent.id,
            TicketEvent.ticket_id,
            TicketEvent.type,
            TicketEvent.from_status,
            TicketEvent.to_status,
            TicketEvent.note,
            TicketEvent.visibility,
            TicketEvent.created_at,
            event_actor.id.label("actor_id"),
            event_actor.name.label("actor_name"),
            event_actor.role.label("actor_role"),
        )
        .join(event_actor, event_actor.id == TicketEvent.actor_id)
        .where(
            TicketEvent.ticket_id == ticket_id,
            TicketEvent.visibility.in_(visible_values),
        )
        .order_by(TicketEvent.created_at.asc(), TicketEvent.id.asc())
    )
    return tuple(
        EventReadData(
            kind="EVENT",
            id=row.id,
            ticket_id=row.ticket_id,
            actor=UserReadData(
                id=row.actor_id, name=row.actor_name, role=row.actor_role
            ),
            type=row.type,
            from_status=row.from_status,
            to_status=row.to_status,
            note=row.note,
            visibility=row.visibility,
            created_at=row.created_at,
        )
        for row in db.execute(statement)
    )


def _comment_reads(
    db: Session, *, actor: User, ticket_id: int
) -> tuple[CommentReadData, ...]:
    author = aliased(User, name="comment_author")
    visible_values = ("PUBLIC", "ADMIN_ONLY") if actor.role == "ADMIN" else ("PUBLIC",)
    statement = (
        select(
            Comment.id,
            Comment.ticket_id,
            Comment.body,
            Comment.visibility,
            Comment.created_at,
            author.id.label("author_id"),
            author.name.label("author_name"),
            author.role.label("author_role"),
        )
        .join(author, author.id == Comment.author_id)
        .where(Comment.ticket_id == ticket_id, Comment.visibility.in_(visible_values))
        .order_by(Comment.created_at.asc(), Comment.id.asc())
    )
    return tuple(
        CommentReadData(
            kind="COMMENT",
            id=row.id,
            ticket_id=row.ticket_id,
            author=UserReadData(
                id=row.author_id, name=row.author_name, role=row.author_role
            ),
            body=row.body,
            visibility=row.visibility,
            created_at=row.created_at,
        )
        for row in db.execute(statement)
    )


def get_ticket_read(
    db: Session, *, actor: User, ticket_id: int
) -> TicketDetailReadData:
    """Read a visible ticket before considering any descendant records.

    Missing and inaccessible tickets intentionally have identical 404 errors.
    Columns, not ORM entities, are queried to avoid identity-map snapshots and
    private-field serialization. The caller owns the transaction and must add
    Workflow projections before exposing a public TicketDetail API response.
    """
    with db.no_autoflush:
        _require_read_actor(actor)
        if type(ticket_id) is not int or not 1 <= ticket_id <= 2**63 - 1:
            raise ValueError("ticket_id must be a positive bigint")

        statement = (
            _ticket_statement()
            .add_columns(Ticket.description.label("description"))
            .where(Ticket.id == ticket_id, _visibility_condition(actor))
        )
        ticket_row = db.execute(statement).one_or_none()
        if ticket_row is None:
            raise AppError(ErrorCode.NOT_FOUND, 404, "Resource not found.")

        ticket = _ticket_from_row(ticket_row)
        attachments = _attachment_reads(db, ticket_id)
        assignments = _assignment_reads(db, ticket_id)
        events = _event_reads(db, actor=actor, ticket_id=ticket_id)
        comments = _comment_reads(db, actor=actor, ticket_id=ticket_id)
        timeline = tuple(
            sorted(
                (*events, *comments),
                key=lambda entry: (entry.created_at, entry.kind, entry.id),
            )
        )

    return TicketDetailReadData(
        **ticket.model_dump(),
        description=ticket_row._mapping["description"],
        report_photos=tuple(
            attachment
            for attachment in attachments
            if attachment.purpose == "REPORT_PHOTO"
        ),
        resolution_photos=tuple(
            attachment
            for attachment in attachments
            if attachment.purpose == "RESOLUTION_PHOTO"
        ),
        assignments=assignments,
        timeline=timeline,
    )
