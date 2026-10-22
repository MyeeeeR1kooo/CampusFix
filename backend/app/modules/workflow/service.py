"""Authorized, version-checked ticket transitions and their single transaction."""

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Assignment, Comment, Ticket, TicketEvent, User
from app.modules.attachments.service import PreparedPhoto, discard_photos, publish_photos, stage_photos
from app.modules.workflow.rules import TERMINAL_STATUSES, TRANSITIONS


RESPONSIBILITY = {
    "SUBMITTED": ("ADMIN", "REVIEW"),
    "PENDING_ASSIGNMENT": ("ADMIN", "ASSIGN"),
    "ASSIGNED": ("TECHNICIAN", "START"),
    "IN_PROGRESS": ("TECHNICIAN", "RESOLVE"),
    "PENDING_CONFIRMATION": ("REPORTER", "CONFIRM_OR_REWORK"),
}


def _visible(ticket: Ticket, actor: User) -> bool:
    return (
        actor.role == "ADMIN"
        or actor.role == "REPORTER" and ticket.reporter_id == actor.id
        or actor.role == "TECHNICIAN" and ticket.current_assignee_id == actor.id
    )


def _authorized(ticket: Ticket, actor: User, required_role: str) -> bool:
    return (
        actor.role == required_role
        and (required_role == "ADMIN"
             or required_role == "REPORTER" and ticket.reporter_id == actor.id
             or required_role == "TECHNICIAN" and ticket.current_assignee_id == actor.id)
    )


def _check_access(ticket: Ticket, actor: User, required_role: str) -> None:
    if not _visible(ticket, actor):
        raise AppError(ErrorCode.NOT_FOUND, 404, "Ticket not found.")
    if not _authorized(ticket, actor, required_role):
        raise AppError(ErrorCode.FORBIDDEN, 403, "This action is not allowed.")


def _check_state(ticket: Ticket, from_status: str, expected_version: int) -> None:
    if ticket.version != expected_version:
        raise AppError(ErrorCode.TICKET_VERSION_CONFLICT, 409, "Ticket version has changed.")
    if ticket.status != from_status:
        raise AppError(ErrorCode.CONFLICT, 409, "Ticket state does not allow this action.")


def _utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _user_summary(user: User) -> dict:
    return {"id": user.id, "name": user.name, "role": user.role}


def ticket_summary(db: Session, ticket: Ticket, actor: User) -> dict:
    """Serialize the frozen TicketSummary shape for a related actor."""
    reporter = db.get(User, ticket.reporter_id)
    assignee = db.get(User, ticket.current_assignee_id) if ticket.current_assignee_id else None
    role, next_action = RESPONSIBILITY.get(ticket.status, (None, None))
    allowed = []
    if ticket.status not in TERMINAL_STATUSES:
        if actor.role == "ADMIN":
            if ticket.status == "SUBMITTED":
                allowed.append("REVIEW")
            elif ticket.status == "PENDING_ASSIGNMENT":
                allowed.append("ASSIGN")
        elif actor.role == "REPORTER" and ticket.reporter_id == actor.id:
            if ticket.status == "SUBMITTED":
                allowed.append("CANCEL")
            elif ticket.status == "PENDING_CONFIRMATION":
                allowed.extend(("CONFIRM", "REWORK"))
        elif actor.role == "TECHNICIAN" and ticket.current_assignee_id == actor.id:
            if ticket.status == "ASSIGNED":
                allowed.append("START")
            elif ticket.status == "IN_PROGRESS":
                allowed.append("RESOLVE")
        allowed.append("COMMENT_PUBLIC")
        if actor.role == "ADMIN":
            allowed.append("COMMENT_ADMIN_ONLY")
    return {
        "id": ticket.id,
        "code": ticket.code,
        "reporter": _user_summary(reporter),
        "location_id": ticket.location_id,
        "location_label_snapshot": ticket.location_label_snapshot,
        "title": ticket.title,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "current_assignee": _user_summary(assignee) if assignee else None,
        "version": ticket.version,
        "created_at": _utc(ticket.created_at),
        "updated_at": _utc(ticket.updated_at),
        "closed_at": _utc(ticket.closed_at) if ticket.closed_at else None,
        "current_responsible_role": role,
        "next_action": next_action,
        "allowed_actions": allowed,
    }


def visible_timeline(db: Session, ticket: Ticket, actor: User) -> list[dict]:
    """Return visible events and comments for a ticket detail response."""
    if not _visible(ticket, actor):
        raise AppError(ErrorCode.NOT_FOUND, 404, "Ticket not found.")
    allowed_visibility = ("PUBLIC", "ADMIN_ONLY") if actor.role == "ADMIN" else ("PUBLIC",)
    events = db.scalars(select(TicketEvent).where(
        TicketEvent.ticket_id == ticket.id,
        TicketEvent.visibility.in_(allowed_visibility),
    )).all()
    comments = db.scalars(select(Comment).where(
        Comment.ticket_id == ticket.id,
        Comment.visibility.in_(allowed_visibility),
    )).all()
    actor_ids = {event.actor_id for event in events} | {comment.author_id for comment in comments}
    actors = {
        user.id: user for user in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
    }
    rows = [
        {
            "kind": "EVENT", "id": event.id, "ticket_id": ticket.id,
            "actor": _user_summary(actors[event.actor_id]), "type": event.type,
            "from_status": event.from_status, "to_status": event.to_status,
            "note": event.note, "visibility": event.visibility,
            "created_at": _utc(event.created_at),
        }
        for event in events
    ] + [
        {
            "kind": "COMMENT", "id": comment.id, "ticket_id": ticket.id,
            "author": _user_summary(actors[comment.author_id]), "body": comment.body,
            "visibility": comment.visibility, "created_at": _utc(comment.created_at),
        }
        for comment in comments
    ]
    return sorted(rows, key=lambda row: (row["created_at"], row["kind"], row["id"]))


def transition(
    db: Session, ticket_id: int, actor: User, action: str, expected_version: int,
    *, category: str = None, priority: str = None, note: str = None,
    technician_id: int = None, photos: list[PreparedPhoto] = None,
) -> dict:
    rule = TRANSITIONS[action]
    photos = photos or []
    published = []
    try:
        ticket = db.get(Ticket, ticket_id)
        if ticket is None:
            raise AppError(ErrorCode.NOT_FOUND, 404, "Ticket not found.")
        _check_access(ticket, actor, rule.actor)
        _check_state(ticket, rule.from_status, expected_version)

        if action == "ASSIGN":
            technician = db.scalar(
                select(User).where(User.id == technician_id).with_for_update()
            )
            if technician is None or technician.role != "TECHNICIAN" or not technician.active:
                raise AppError(
                    ErrorCode.VALIDATION_ERROR, 422, "Select an active technician.",
                    [{"field": "technician_id", "message": "Select an active technician.", "type": "value_error"}],
                )

        now = datetime.now(timezone.utc)
        values = {"status": rule.to_status, "version": Ticket.version + 1, "updated_at": now}
        if action == "APPROVE":
            values.update(category=category, priority=priority)
        elif action == "ASSIGN":
            values["current_assignee_id"] = technician_id
        elif action == "CONFIRM":
            values["closed_at"] = now
        changed = db.execute(
            update(Ticket).where(
                Ticket.id == ticket_id,
                Ticket.status == rule.from_status,
                Ticket.version == expected_version,
            ).values(**values).returning(Ticket.id)
        ).scalar_one_or_none()
        if changed is None:
            db.expire_all()
            current = db.get(Ticket, ticket_id)
            if current is None:
                raise AppError(ErrorCode.NOT_FOUND, 404, "Ticket not found.")
            _check_access(current, actor, rule.actor)
            _check_state(current, rule.from_status, expected_version)
            raise AppError(ErrorCode.CONFLICT, 409, "Ticket state does not allow this action.")

        if action == "ASSIGN":
            db.add(Assignment(
                ticket_id=ticket_id, technician_id=technician_id, assigned_by=actor.id,
            ))
        db.add(TicketEvent(
            ticket_id=ticket_id, actor_id=actor.id, type=rule.event_type,
            from_status=rule.from_status, to_status=rule.to_status,
            note=note, visibility="PUBLIC",
        ))
        if action == "RESOLVE":
            stage_photos(db, ticket_id, actor.id, photos)
        db.flush()
        if photos:
            published = publish_photos(photos)
        db.refresh(ticket)
        response = ticket_summary(db, ticket, actor)
        db.commit()
        return response
    except Exception:
        db.rollback()
        discard_photos(photos, published)
        raise
