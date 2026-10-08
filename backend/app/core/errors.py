from enum import Enum
from typing import Any, Dict, List, Optional, Union


class ErrorCode(str, Enum):
    """Stable error codes shared by API modules."""

    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    TICKET_VERSION_CONFLICT = "TICKET_VERSION_CONFLICT"
    ORIGIN_NOT_ALLOWED = "ORIGIN_NOT_ALLOWED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """An expected API error with a stable client-facing code."""

    def __init__(
        self,
        code: Union[str, ErrorCode],
        status_code: int,
        message: str,
        field_errors: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code.value if isinstance(code, ErrorCode) else code
        self.status_code = status_code
        self.message = message
        self.field_errors = field_errors or []


def error_payload(
    *,
    code: Union[str, ErrorCode],
    message: str,
    request_id: str,
    field_errors: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    return {
        "error": {
            "code": code.value if isinstance(code, ErrorCode) else code,
            "message": message,
            "request_id": request_id,
            "field_errors": field_errors or [],
        }
    }
