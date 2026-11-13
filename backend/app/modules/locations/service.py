"""Location persistence; never writes tickets or historical location snapshots."""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ErrorCode
from app.models import Location
from app.modules.locations.cursor import decode_cursor, encode_cursor
from app.modules.locations.schemas import CreateLocationRequest, LocationListResponse, LocationResponse, UpdateLocationRequest


def list_locations(
    db: Session, cursor: Optional[str], limit: int, active_only: bool, secret: str,
) -> LocationListResponse:
    statement = select(Location)
    if active_only:
        statement = statement.where(Location.active.is_(True))
    if cursor is not None:
        created_at, location_id = decode_cursor(cursor, active_only, secret)
        statement = statement.where(tuple_(Location.created_at, Location.id) < (created_at, location_id))
    rows = db.scalars(statement.order_by(Location.created_at.desc(), Location.id.desc()).limit(limit + 1)).all()
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = encode_cursor(last.created_at, last.id, active_only, secret)
    return LocationListResponse(
        items=[LocationResponse.model_validate(row) for row in rows[:limit]],
        next_cursor=next_cursor,
    )


def _save(db: Session, location: Location) -> LocationResponse:
    try:
        db.flush()
        # Serialize while server-generated fields are available, before committing.
        response = LocationResponse.model_validate(location)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if (getattr(exc.orig, "sqlstate", None) == "23505"
                and getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "uq_locations_address"):
            raise AppError(ErrorCode.CONFLICT, 409, "This location already exists.") from None
        raise
    except Exception:
        db.rollback()
        raise
    return response


def create_location(db: Session, payload: CreateLocationRequest) -> LocationResponse:
    location = Location(**payload.model_dump())
    db.add(location)
    return _save(db, location)


def update_location(db: Session, location_id: int, payload: UpdateLocationRequest) -> LocationResponse:
    # Serialize maintenance of one row so partial/no-op fields use the latest
    # committed values, and the returned location matches this transaction.
    location = db.get(Location, location_id, with_for_update=True, populate_existing=True)
    if location is None:
        raise AppError(ErrorCode.NOT_FOUND, 404, "Location not found.")
    for name, value in payload.model_dump(exclude_unset=True).items():
        setattr(location, name, value)
    location.updated_at = datetime.now(timezone.utc)
    return _save(db, location)
