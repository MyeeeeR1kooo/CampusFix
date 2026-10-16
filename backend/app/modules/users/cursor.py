"""Signed pagination cursors for the account list."""

import base64
import binascii
import hashlib
import hmac
import json
from datetime import datetime
from typing import Optional, Tuple

from app.core.errors import AppError, ErrorCode


def _invalid_cursor() -> AppError:
    return AppError(ErrorCode.VALIDATION_ERROR, 400, "Invalid cursor.")


def encode_cursor(created_at: datetime, user_id: int, role: Optional[str], active: Optional[bool], secret: str) -> str:
    payload = json.dumps(
        {"created_at": created_at.isoformat(), "id": user_id, "role": role, "active": active},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload + signature).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, role: Optional[str], active: Optional[bool], secret: str) -> Tuple[datetime, int]:
    try:
        if len(cursor) > 1024:
            raise ValueError("cursor too long")
        signed = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload, signature = signed[:-32], signed[-32:]
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("invalid signature")
        data = json.loads(payload)
        if set(data) != {"created_at", "id", "role", "active"}:
            raise ValueError("invalid fields")
        if data["role"] != role or data["active"] != active:
            raise ValueError("filters changed")
        created_at = datetime.fromisoformat(data["created_at"])
        user_id = data["id"]
        if created_at.tzinfo is None or type(user_id) is not int or user_id < 1:
            raise ValueError("invalid position")
        return created_at, user_id
    except (ValueError, TypeError, KeyError, UnicodeDecodeError, binascii.Error):
        raise _invalid_cursor() from None
