"""Opaque, signed keyset cursors scoped to each location list."""

import base64
import binascii
import hashlib
import hmac
import json
from datetime import datetime
from typing import Tuple

from app.core.errors import AppError, ErrorCode


def encode_cursor(created_at: datetime, location_id: int, active_only: bool, secret: str) -> str:
    payload = json.dumps(
        {"resource": "locations", "created_at": created_at.isoformat(),
         "id": location_id, "active_only": active_only},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload + signature).decode("ascii").rstrip("=")


def decode_cursor(cursor: str, active_only: bool, secret: str) -> Tuple[datetime, int]:
    try:
        if len(cursor) > 1024:
            raise ValueError("cursor too long")
        signed = base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        payload, signature = signed[:-32], signed[-32:]
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("invalid signature")
        data = json.loads(payload)
        if not isinstance(data, dict) or set(data) != {"resource", "created_at", "id", "active_only"}:
            raise ValueError("invalid fields")
        if data["resource"] != "locations" or type(data["active_only"]) is not bool:
            raise ValueError("invalid scope")
        if data["active_only"] != active_only:
            raise ValueError("list scope changed")
        created_at = datetime.fromisoformat(data["created_at"])
        location_id = data["id"]
        if created_at.tzinfo is None or type(location_id) is not int or not 1 <= location_id <= 2**63 - 1:
            raise ValueError("invalid position")
        return created_at, location_id
    except (ValueError, TypeError, KeyError, UnicodeDecodeError, binascii.Error):
        raise AppError(ErrorCode.VALIDATION_ERROR, 400, "Invalid cursor.") from None
