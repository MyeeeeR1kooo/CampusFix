"""P0 row mappings shared by business modules; Alembic owns schema creation.

These classes contain no workflow or authorization logic. Import them alongside
the existing core.database.get_db / SessionLocal, never call create_all().
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, Identity,
    Index, Integer, Text, UniqueConstraint, text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class IdentityRow:
    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)


class CreatedRow:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP")
    )


class UpdatedRow(CreatedRow):
    # Services set updated_at in the same transaction as their write.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP")
    )


class User(IdentityRow, UpdatedRow, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        CheckConstraint("role IN ('REPORTER', 'TECHNICIAN', 'ADMIN')", name="ck_users_role"),
    )
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Session(IdentityRow, CreatedRow, Base):
    __tablename__ = "sessions"
    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
        Index("ix_sessions_user_id", "user_id"),
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token_hash: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Location(IdentityRow, UpdatedRow, Base):
    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("building", "floor", "room_or_area", name="uq_locations_address"),
        CheckConstraint("length(building) > 0 AND length(floor) > 0 AND length(room_or_area) > 0", name="ck_locations_nonempty"),
    )
    building: Mapped[str] = mapped_column(Text)
    floor: Mapped[str] = mapped_column(Text)
    room_or_area: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Ticket(IdentityRow, UpdatedRow, Base):
    __tablename__ = "tickets"
    __table_args__ = (
        UniqueConstraint("code", name="uq_tickets_code"),
        CheckConstraint("status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name="ck_tickets_status"),
        CheckConstraint("category IN ('LIGHTING_ELECTRICAL', 'DOORS_WINDOWS_LOCKS', 'FURNITURE', 'HVAC', 'WATER_SANITARY', 'OTHER_FACILITY')", name="ck_tickets_category"),
        CheckConstraint("priority IS NULL OR priority IN ('LOW', 'MEDIUM', 'HIGH')", name="ck_tickets_priority"),
        CheckConstraint("status IN ('SUBMITTED', 'REJECTED', 'CANCELLED') OR priority IS NOT NULL", name="ck_tickets_priority_required"),
        CheckConstraint("version >= 1", name="ck_tickets_version"),
        CheckConstraint("(status = 'CLOSED' AND closed_at IS NOT NULL) OR (status <> 'CLOSED' AND closed_at IS NULL)", name="ck_tickets_closed_at"),
        CheckConstraint("(status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'REJECTED', 'CANCELLED') AND current_assignee_id IS NULL) OR (status IN ('ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED') AND current_assignee_id IS NOT NULL)", name="ck_tickets_assignee"),
        Index("ix_tickets_reporter_created_id", "reporter_id", text("created_at DESC"), text("id DESC")),
        Index("ix_tickets_assignee_created_id", "current_assignee_id", text("created_at DESC"), text("id DESC")),
        Index("ix_tickets_status_created_id", "status", text("created_at DESC"), text("id DESC")),
        Index("ix_tickets_location_created_id", "location_id", text("created_at DESC"), text("id DESC")),
    )
    code: Mapped[str] = mapped_column(Text)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    location_label_snapshot: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    priority: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, server_default=text("'SUBMITTED'"))
    current_assignee_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class Assignment(IdentityRow, Base):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("ix_assignments_ticket_id", "ticket_id"),
        Index("ix_assignments_technician_id", "technician_id"),
        Index("ix_assignments_assigned_by", "assigned_by"),
        Index("uq_assignments_current_ticket", "ticket_id", unique=True, postgresql_where=text("ended_at IS NULL")),
    )
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigned_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    reason: Mapped[Optional[str]] = mapped_column(Text)


class TicketEvent(IdentityRow, CreatedRow, Base):
    __tablename__ = "ticket_events"
    __table_args__ = (
        CheckConstraint("visibility IN ('PUBLIC', 'ADMIN_ONLY')", name="ck_ticket_events_visibility"),
        CheckConstraint("from_status IS NULL OR from_status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name="ck_ticket_events_from_status"),
        CheckConstraint("to_status IN ('SUBMITTED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'CLOSED', 'REJECTED', 'CANCELLED')", name="ck_ticket_events_to_status"),
        Index("ix_ticket_events_ticket_created_id", "ticket_id", "created_at", "id"),
    )
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    actor_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(Text)
    from_status: Mapped[Optional[str]] = mapped_column(Text)
    to_status: Mapped[str] = mapped_column(Text)
    note: Mapped[Optional[str]] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(Text)


class Comment(IdentityRow, CreatedRow, Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint("visibility IN ('PUBLIC', 'ADMIN_ONLY')", name="ck_comments_visibility"),
        Index("ix_comments_ticket_created_id", "ticket_id", "created_at", "id"),
    )
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(Text)


class Attachment(IdentityRow, CreatedRow, Base):
    __tablename__ = "attachments"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_attachments_storage_key"),
        CheckConstraint("purpose IN ('REPORT_PHOTO', 'RESOLUTION_PHOTO')", name="ck_attachments_purpose"),
        Index("ix_attachments_ticket_id", "ticket_id"),
        Index("ix_attachments_uploader_id", "uploader_id"),
    )
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id"))
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    storage_key: Mapped[str] = mapped_column(Text)
    original_name: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(BigInteger)
    purpose: Mapped[str] = mapped_column(Text)
