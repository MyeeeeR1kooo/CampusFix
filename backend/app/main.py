import secrets
from typing import Any, Dict

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.errors import AppError, ErrorCode, error_payload
from app.core.security import OriginError, require_same_origin


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "req_" + secrets.token_urlsafe(12))


def _validation_fields(exc: RequestValidationError) -> list[Dict[str, Any]]:
    fields = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", []) if part != "body"]
        fields.append(
            {
                "field": ".".join(location),
                "message": error.get("msg", "Invalid value"),
                "type": error.get("type", "validation_error"),
            }
        )
    return fields


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="CampusFix API", version="0.1.0")

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = "req_" + secrets.token_urlsafe(12)
        try:
            require_same_origin(request, settings)
        except OriginError:
            request_id = request.state.request_id
            return JSONResponse(
                status_code=403,
                content=error_payload(
                    code=ErrorCode.ORIGIN_NOT_ALLOWED,
                    message="The request origin is not allowed.",
                    request_id=request_id,
                ),
                headers={"X-Request-ID": request_id},
            )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=exc.code,
                message=exc.message,
                request_id=_request_id(request),
                field_errors=exc.field_errors,
            ),
            headers={"X-Request-ID": _request_id(request)},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        request_id = _request_id(request)
        return JSONResponse(
            status_code=422,
            content=error_payload(
                code="VALIDATION_ERROR",
                message="Request validation failed.",
                request_id=request_id,
                field_errors=_validation_fields(exc),
            ),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(OriginError)
    async def handle_origin_error(request: Request, exc: OriginError):
        request_id = _request_id(request)
        return JSONResponse(
            status_code=403,
            content=error_payload(
                code=ErrorCode.ORIGIN_NOT_ALLOWED,
                message="The request origin is not allowed.",
                request_id=request_id,
            ),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException):
        request_id = _request_id(request)
        code_by_status = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND"}
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=code_by_status.get(exc.status_code, ErrorCode.CONFLICT.value),
                message=message,
                request_id=request_id,
            ),
            headers={"X-Request-ID": request_id},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        request_id = _request_id(request)
        return JSONResponse(
            status_code=500,
            content=error_payload(
                code=ErrorCode.INTERNAL_ERROR,
                message="An unexpected error occurred.",
                request_id=request_id,
            ),
            headers={"X-Request-ID": request_id},
        )

    @app.get("/health")
    async def health() -> Dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
