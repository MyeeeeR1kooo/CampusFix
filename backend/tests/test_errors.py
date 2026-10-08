from fastapi import FastAPI
from fastapi.testclient import TestClient


def test_app_error_serializes_to_the_frozen_error_envelope():
    from app.core.errors import AppError, ErrorCode
    from app.main import create_app

    app = create_app()

    @app.get("/test-error")
    def test_error():
        raise AppError(
            code="TICKET_VERSION_CONFLICT",
            status_code=409,
            message="The test resource is already updated.",
        )

    response = TestClient(app).get("/test-error")

    assert response.status_code == 409
    payload = response.json()["error"]
    assert payload["code"] == "TICKET_VERSION_CONFLICT"
    assert payload["message"] == "The test resource is already updated."
    assert payload["request_id"].startswith("req_")
    assert payload["field_errors"] == []
    assert response.headers["x-request-id"] == payload["request_id"]
    assert ErrorCode.TICKET_VERSION_CONFLICT.value == "TICKET_VERSION_CONFLICT"


def test_unexpected_error_does_not_expose_internal_details():
    from app.main import create_app

    app = create_app()

    @app.get("/unexpected")
    def unexpected():
        raise RuntimeError("database password should not be exposed")

    response = TestClient(app, raise_server_exceptions=False).get("/unexpected")

    assert response.status_code == 500
    payload = response.json()["error"]
    assert payload["code"] == "INTERNAL_ERROR"
    assert payload["message"] == "An unexpected error occurred."
    assert "password" not in response.text
