"""Signed ticket-list cursors and descending seek expressions.

Callers must authenticate an active user, authorize and normalize their filters,
apply visibility filters before pagination, and order by created_at/id DESC.
These helpers do not load configuration, models, a database, or user sessions.
Opaque cursors are authenticated, not encrypted; they are not access tokens.
"""

import base64
import binascii
import hashlib
import hmac
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Union

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.core.errors import AppError, ErrorCode


FilterValue = Union[str, int, datetime, None]
_FILTER_NAMES = frozenset({
    "status", "category", "priority", "building", "created_from",
    "created_before", "q", "current_assignee_id",
})
_ROLES = frozenset({"REPORTER", "TECHNICIAN", "ADMIN"})
_DOMAIN = b"CampusFix:tickets:list:cursor:v1\x00"
_MAX_ID = 2**63 - 1
_MAX_CURSOR_LENGTH = 512


def _positive_id(value: Any) -> bool:
    return type(value) is int and 1 <= value <= _MAX_ID


def _utc_text(value: datetime) -> str:
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise ValueError("A timezone-aware datetime is required.")
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class CursorPosition:
    created_at: datetime
    ticket_id: int

    def __post_init__(self) -> None:
        _utc_text(self.created_at)
        if not _positive_id(self.ticket_id):
            raise ValueError("A positive bigint ticket ID is required.")


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _scope_hash(*, user_id: int, role: str, filters: Mapping[str, FilterValue]) -> str:
    # Trusted, already-validated caller input. This is not an Auth implementation.
    if not _positive_id(user_id) or not isinstance(role, str) or role not in _ROLES:
        raise ValueError("A current user ID and role are required.")
    if not isinstance(filters, Mapping):
        raise ValueError("Validated ticket filters are required.")
    normalized = {}
    for name, value in filters.items():
        if not isinstance(name, str) or name not in _FILTER_NAMES:
            raise ValueError("An unsupported ticket filter was supplied.")
        if value is None:
            continue
        if isinstance(value, datetime):
            normalized[name] = _utc_text(value)
        elif isinstance(value, str) or type(value) is int:
            # Do not trim q/building or decide keyword matching semantics here.
            normalized[name] = value
        else:
            raise ValueError("Ticket filters must contain validated scalar values.")
    return hashlib.sha256(_canonical_json({"user_id": user_id, "role": role, "filters": normalized})).hexdigest()


def _key(secret_key: str) -> bytes:
    if not isinstance(secret_key, str) or not secret_key:
        raise ValueError("An explicit signing secret is required.")
    return secret_key.encode("utf-8")


def _encode_part(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_part(value: str) -> bytes:
    if not value or re.fullmatch(r"[A-Za-z0-9_-]+", value) is None:
        raise ValueError("Invalid cursor encoding.")
    decoded = base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)
    if _encode_part(decoded) != value:
        raise ValueError("Noncanonical cursor encoding.")
    return decoded


def encode_ticket_cursor(
    position: CursorPosition, *, secret_key: str, user_id: int,
    role: str, filters: Mapping[str, FilterValue],
) -> str:
    """Create a cursor bound to the authenticated principal and list filters.

    Use the last returned row's position only when another page exists. Limit is
    a page size, not a filter, and is deliberately not part of the scope.
    """
    payload = _encode_part(_canonical_json({
        "v": 1,
        "created_at": _utc_text(position.created_at),
        "id": position.ticket_id,
        "scope": _scope_hash(user_id=user_id, role=role, filters=filters),
    }))
    signature = hmac.new(_key(secret_key), _DOMAIN + payload.encode("ascii"), hashlib.sha256).digest()
    return payload + "." + _encode_part(signature)


def decode_ticket_cursor(
    cursor: str, *, secret_key: str, user_id: int,
    role: str, filters: Mapping[str, FilterValue],
) -> CursorPosition:
    """Reject malformed, modified, or out-of-scope cursors with a safe 400.

    An omitted cursor means the first page and is handled by the caller; an
    explicitly empty string is malformed. Authentication must run first.
    """
    key = _key(secret_key)
    expected_scope = _scope_hash(user_id=user_id, role=role, filters=filters)
    try:
        if not isinstance(cursor, str) or not cursor or len(cursor) > _MAX_CURSOR_LENGTH:
            raise ValueError("Invalid cursor.")
        parts = cursor.split(".")
        if len(parts) != 2:
            raise ValueError("Invalid cursor.")
        encoded, signature_text = parts
        payload_bytes = _decode_part(encoded)
        signature = _decode_part(signature_text)
        expected_signature = hmac.new(key, _DOMAIN + encoded.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_signature):
            raise ValueError("Invalid signature.")
        payload = json.loads(payload_bytes.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"v", "created_at", "id", "scope"}:
            raise ValueError("Invalid cursor payload.")
        if type(payload["v"]) is not int or payload["v"] != 1 or not _positive_id(payload["id"]):
            raise ValueError("Invalid cursor position.")
        scope = payload["scope"]
        if not isinstance(scope, str) or re.fullmatch(r"[0-9a-f]{64}", scope) is None:
            raise ValueError("Invalid cursor scope.")
        if not hmac.compare_digest(scope, expected_scope):
            raise ValueError("The cursor scope does not match.")
        stamp = payload["created_at"]
        if not isinstance(stamp, str) or not stamp.endswith("Z"):
            raise ValueError("Invalid cursor time.")
        created_at = datetime.fromisoformat(stamp[:-1] + "+00:00")
        if _utc_text(created_at) != stamp or _canonical_json(payload) != payload_bytes:
            raise ValueError("Noncanonical cursor payload.")
        return CursorPosition(created_at=created_at, ticket_id=payload["id"])
    except (ValueError, TypeError, UnicodeError, binascii.Error, OverflowError):
        raise AppError(
            code=ErrorCode.VALIDATION_ERROR,
            status_code=400,
            message="Invalid pagination cursor.",
        ) from None


def ticket_seek_predicate(
    created_at_column: ColumnElement, id_column: ColumnElement,
    position: CursorPosition,
) -> ColumnElement:
    """Rows strictly after the cursor in created_at DESC, id DESC order.

    Pass the actual SQLAlchemy model columns after the shared model handoff.
    This expression does not execute SQL or enforce resource visibility.
    """
    created_at = position.created_at.astimezone(timezone.utc)
    return or_(
        created_at_column < created_at,
        and_(created_at_column == created_at, id_column < position.ticket_id),
    )
