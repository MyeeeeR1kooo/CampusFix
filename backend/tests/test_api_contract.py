"""Issue #46 contract checks, not proof of unimplemented business API behavior.

Schema/examples are checked independently of PostgreSQL. Runtime checks exercise
only the existing Core and test-only routes; later module integration tests must
prove permissions, transactions, file validation and optimistic locking.
"""

from copy import deepcopy
from pathlib import Path

import pytest
import yaml
from fastapi import Body, HTTPException
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, FormatChecker
from openapi_spec_validator import validate
from pydantic import BaseModel
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from app.core.config import Settings, get_settings
from app.core.errors import AppError, ErrorCode
from app.core.security import SESSION_COOKIE_NAME, set_session_cookie
from app.main import create_app


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs/api/openapi.yaml"
CONTRACT_URI = "urn:campusfix:api-contract"
METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
EXPECTED_OPERATIONS = {
    ("get", "/health"),
    ("post", "/api/auth/login"),
    ("post", "/api/auth/logout"),
    ("get", "/api/me"),
    ("post", "/api/tickets"),
    ("get", "/api/tickets"),
    ("get", "/api/tickets/{id}"),
    *(("post", f"/api/tickets/{{id}}/{action}") for action in (
        "review", "assign", "start", "resolve", "confirm", "rework", "cancel", "comments"
    )),
    ("get", "/api/attachments/{id}"),
    ("get", "/api/locations"),
    ("get", "/api/admin/locations"),
    ("post", "/api/admin/locations"),
    ("patch", "/api/admin/locations/{id}"),
    ("get", "/api/admin/users"),
    ("patch", "/api/admin/users/{id}/active"),
    ("get", "/api/admin/analytics"),
}
ACTION_SCHEMAS = {
    "review": "ReviewRequest", "assign": "AssignRequest", "start": "StartRequest",
    "resolve": "ResolveRequest", "confirm": "VersionRequest",
    "rework": "ReworkRequest", "cancel": "CancelRequest",
}


class UniqueKeyLoader(yaml.SafeLoader):
    """Reject silently overwritten YAML fields in the authoritative contract."""

    def construct_mapping(self, node, deep=False):
        keys = [self.construct_object(key, deep=deep) for key, _ in node.value]
        if len(keys) != len(set(keys)):
            raise ValueError(f"Duplicate YAML key near line {node.start_mark.line + 1}")
        return super().construct_mapping(node, deep=deep)


@pytest.fixture(scope="module")
def contract():
    return yaml.load(CONTRACT_PATH.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)


def pointer(parts):
    return "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in parts)


def resolve(contract, value, parts=()):
    while isinstance(value, dict) and "$ref" in value:
        reference = value["$ref"]
        assert reference.startswith("#/"), f"Uncontrolled external reference: {reference}"
        parts = tuple(part.replace("~1", "/").replace("~0", "~") for part in reference[2:].split("/"))
        value = contract
        for part in parts:
            value = value[part]
    return value, parts


def validator_at(contract, parts):
    registry = Registry().with_resource(
        CONTRACT_URI, Resource.from_contents(contract, default_specification=DRAFT202012)
    )
    return Draft202012Validator(
        {"$ref": CONTRACT_URI + "#" + pointer(parts)},
        registry=registry,
        format_checker=FormatChecker(),
    )


def schema_validator(contract, name):
    return validator_at(contract, ("components", "schemas", name))


def samples(contract, media):
    if "example" in media:
        yield media["example"]
    for value in media.get("examples", {}).values():
        example, _ = resolve(contract, value)
        assert "value" in example, "Examples must be local, reproducible values"
        yield example["value"]


def operations(contract):
    for path, path_item in contract["paths"].items():
        for method, operation in path_item.items():
            if method in METHODS:
                yield path, method, path_item, operation


def response(contract, operation, status):
    return resolve(contract, operation["responses"][status])


def test_valid_openapi_and_json_schema_dialects(contract):
    assert contract["openapi"] == "3.1.0"
    validate(contract)
    for schema in contract["components"]["schemas"].values():
        Draft202012Validator.check_schema(schema)


def test_exact_frozen_p0_route_coverage_without_extra_features(contract):
    actual = {(method, path) for path, method, _, _ in operations(contract)}
    assert actual == EXPECTED_OPERATIONS
    assert len(actual) == 23  # 22 baseline business operations plus implemented /health.
    operation_ids = [operation["operationId"] for _, _, _, operation in operations(contract)]
    assert len(operation_ids) == len(set(operation_ids))
    assert all(path == "/health" or path.startswith("/api/") for _, path in actual)
    # The status flips from pending-review to frozen when the contract is approved.
    # Asserting one exact value would make the freeze itself break this test, so the
    # guard only rejects a status that is neither of the two known states.
    assert contract["x-contract-status"] in {"pending-review", "frozen"}


def test_all_existing_public_core_routes_are_documented(contract):
    documented = {(method, path) for path, method, _, _ in operations(contract)}
    implemented = {
        (method.lower(), route.path)
        for route in create_app().routes if getattr(route, "include_in_schema", False)
        for method in route.methods
    }
    assert implemented <= documented
    # This subset check intentionally does not claim planned endpoints are live.


def test_session_security_and_origin_headers_match_core(contract):
    cookie = contract["components"]["securitySchemes"]["SessionCookie"]
    assert (cookie["type"], cookie["in"], cookie["name"]) == ("apiKey", "cookie", SESSION_COOKIE_NAME)
    assert contract["security"] == [{"SessionCookie": []}]
    for path, method, path_item, operation in operations(contract):
        security = operation.get("security", contract["security"])
        assert security == ([] if path in {"/health", "/api/auth/login"} else [{"SessionCookie": []}])
        parameters = [resolve(contract, value)[0] for value in path_item.get("parameters", []) + operation.get("parameters", [])]
        if method in {"post", "put", "patch", "delete"}:
            assert any(p["name"] == "Origin" and p["in"] == "header" and p["required"] for p in parameters)
            assert "403" in operation["responses"]


@pytest.mark.parametrize("path", [
    "/api/tickets", "/api/admin/locations", "/api/admin/users", "/api/admin/analytics",
])
def test_role_restricted_gets_declare_forbidden_without_origin_validation(contract, path):
    path_item = contract["paths"][path]
    operation = path_item["get"]
    assert "403" in operation["responses"], path
    parameters = [
        resolve(contract, value)[0]
        for value in path_item.get("parameters", []) + operation.get("parameters", [])
    ]
    assert not any(p["in"] == "header" and p["name"].lower() == "origin" for p in parameters)


def test_ticket_list_forbidden_has_only_the_applicable_role_error(contract):
    operation = contract["paths"]["/api/tickets"]["get"]
    body, _ = response(contract, operation, "403")
    assert body["headers"]["X-Request-ID"] == {"$ref": "#/components/headers/RequestId"}
    media = body["content"]["application/json"]
    assert media["schema"] == {"$ref": "#/components/schemas/ErrorResponse"}
    examples = list(samples(contract, media))
    assert examples
    for example in examples:
        schema_validator(contract, "ErrorResponse").validate(example)
        assert example["error"]["code"] == ErrorCode.FORBIDDEN.value
        assert example["error"]["field_errors"] == []


def test_enabled_locations_get_does_not_add_a_role_rejection(contract):
    operation = contract["paths"]["/api/locations"]["get"]
    assert "403" not in operation["responses"]


def test_cookie_runtime_attributes_and_contract_examples(contract):
    from fastapi import Response

    settings = Settings(_env_file=None, environment="production", secure_cookies=True)
    assert settings.session_lifetime_seconds == 8 * 60 * 60
    output = Response()
    set_session_cookie(output, "test-only-token", settings)
    cookie = output.headers["set-cookie"]
    for attribute in (f"{SESSION_COOKIE_NAME}=", "HttpOnly", "SameSite=lax", "Secure", "Path=/", "Max-Age=28800"):
        assert attribute in cookie
    contract_cookie = contract["components"]["headers"]["SessionCookie"]["schema"]["example"]
    assert f"{SESSION_COOKIE_NAME}=" in contract_cookie
    assert "Max-Age=28800" in contract_cookie


def test_error_codes_are_exactly_core_enum_and_http_examples_agree(contract):
    assert set(contract["components"]["schemas"]["ErrorCode"]["enum"]) == {code.value for code in ErrorCode}
    expected_codes = {
        "400": {"VALIDATION_ERROR"}, "401": {"UNAUTHORIZED"},
        "403": {"FORBIDDEN", "ORIGIN_NOT_ALLOWED"}, "404": {"NOT_FOUND"},
        "409": {"CONFLICT", "TICKET_VERSION_CONFLICT"},
        "413": {"VALIDATION_ERROR"}, "415": {"VALIDATION_ERROR"},
        "422": {"VALIDATION_ERROR"}, "500": {"INTERNAL_ERROR"},
    }
    for path, method, _, operation in operations(contract):
        for status in operation["responses"]:
            if not status.startswith(("4", "5")):
                continue
            body, _ = response(contract, operation, status)
            assert status in expected_codes, (method, path, status)
            media = body["content"]["application/json"]
            assert media["schema"] == {"$ref": "#/components/schemas/ErrorResponse"}
            example_values = list(samples(contract, media))
            assert example_values, (method, path, status)
            for value in example_values:
                assert value["error"]["code"] in expected_codes[status]
                if status != "422":
                    assert value["error"]["field_errors"] == []


@pytest.mark.parametrize("example_name", [
    "technician_not_found", "technician_wrong_role", "technician_inactive",
])
def test_invalid_assignment_target_is_a_422_field_error(contract, example_name):
    operation = contract["paths"]["/api/tickets/{id}/assign"]["post"]
    body, _ = response(contract, operation, "422")
    example = body["content"]["application/json"]["examples"][example_name]["value"]
    schema_validator(contract, "ErrorResponse").validate(example)
    error = example["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert len(error["field_errors"]) == 1
    assert error["field_errors"][0]["field"] == "technician_id"
    assert error["field_errors"][0]["message"]


def test_every_request_and_json_response_example_validates(contract):
    checked = 0
    for path, method, _, operation in operations(contract):
        if "requestBody" in operation:
            body, parts = resolve(contract, operation["requestBody"], ("paths", path, method, "requestBody"))
            assert body["required"] is True
            for media_type, media in body["content"].items():
                example_values = list(samples(contract, media))
                assert example_values, f"Missing request example for {method.upper()} {path} ({media_type})"
                for value in example_values:
                    validator_at(contract, (*parts, "content", media_type, "schema")).validate(value)
                    checked += 1
        for status, definition in operation["responses"].items():
            body, parts = resolve(contract, definition, ("paths", path, method, "responses", status))
            assert "X-Request-ID" in body.get("headers", {}), (method, path, status)
            if status == "204":
                assert "content" not in body
                continue
            for media_type, media in body.get("content", {}).items():
                if media_type != "application/json":
                    continue  # Streaming image bytes are checked by future attachment integration tests.
                example_values = list(samples(contract, media))
                assert example_values, (method, path, status)
                for value in example_values:
                    validator_at(contract, (*parts, "content", media_type, "schema")).validate(value)
                    checked += 1
    assert checked >= len(EXPECTED_OPERATIONS)


def test_inline_schema_examples_validate_including_headers_and_parameters(contract):
    def visit(value, parts=()):
        if isinstance(value, dict):
            if "example" in value and any(key in value for key in ("type", "$ref", "anyOf", "allOf")):
                validator_at(contract, parts).validate(value["example"])
            for key, child in value.items():
                visit(child, (*parts, key))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                visit(child, (*parts, index))

    visit(contract)


@pytest.mark.parametrize("action", ACTION_SCHEMAS)
def test_every_workflow_action_requires_a_positive_expected_version(contract, action):
    operation = contract["paths"][f"/api/tickets/{{id}}/{action}"]["post"]
    body = operation["requestBody"]["content"]
    assert set(body) == ({"multipart/form-data"} if action == "resolve" else {"application/json"})
    media = next(iter(body.values()))
    assert media["schema"] == {"$ref": "#/components/schemas/" + ACTION_SCHEMAS[action]}
    validator = schema_validator(contract, ACTION_SCHEMAS[action])
    assert "409" in operation["responses"]
    for value in samples(contract, media):
        missing = deepcopy(value)
        missing.pop("expected_version")
        assert not validator.is_valid(missing)
        for invalid_version in (0, -1, "1", None):
            assert not validator.is_valid({**value, "expected_version": invalid_version})


@pytest.mark.parametrize("action,expected_statuses", [
    ("review", {"PENDING_ASSIGNMENT", "REJECTED"}), ("assign", {"ASSIGNED"}),
    ("start", {"IN_PROGRESS"}), ("resolve", {"PENDING_CONFIRMATION"}),
    ("confirm", {"CLOSED"}), ("rework", {"IN_PROGRESS"}), ("cancel", {"CANCELLED"}),
])
def test_workflow_response_examples_match_the_actual_transition(contract, action, expected_statuses):
    operation = contract["paths"][f"/api/tickets/{{id}}/{action}"]["post"]
    body, _ = response(contract, operation, "200")
    response_samples = list(samples(contract, body["content"]["application/json"]))
    assert {value["status"] for value in response_samples} == expected_statuses
    request_media = next(iter(operation["requestBody"]["content"].values()))
    previous_versions = {value["expected_version"] for value in samples(contract, request_media)}
    assert all(value["version"] - 1 in previous_versions for value in response_samples)


@pytest.mark.parametrize("schema_name,expected", [
    ("Role", {"REPORTER", "TECHNICIAN", "ADMIN"}),
    ("ManagedRole", {"REPORTER", "TECHNICIAN"}),
    ("TicketStatus", {"SUBMITTED", "PENDING_ASSIGNMENT", "ASSIGNED", "IN_PROGRESS", "PENDING_CONFIRMATION", "CLOSED", "REJECTED", "CANCELLED"}),
    ("Category", {"LIGHTING_ELECTRICAL", "DOORS_WINDOWS_LOCKS", "FURNITURE", "HVAC", "WATER_SANITARY", "OTHER_FACILITY"}),
    ("Priority", {"LOW", "MEDIUM", "HIGH"}),
    ("Visibility", {"PUBLIC", "ADMIN_ONLY"}),
    ("AttachmentPurpose", {"REPORT_PHOTO", "RESOLUTION_PHOTO"}),
])
def test_baseline_enums_are_exact(contract, schema_name, expected):
    assert set(contract["components"]["schemas"][schema_name]["enum"]) == expected


@pytest.mark.parametrize("schema_name,good,bad", [
    ("Id", 1, 0), ("Id", 1, "1"), ("Version", 1, -1),
    ("UtcDateTime", "2026-10-02T08:00:00Z", "not-a-dateZ"),
    ("UtcDateTime", "2026-10-02T08:00:00Z", "2026-10-02T08:00:00+08:00"),
    ("Photos", ["binary-placeholder"] * 5, ["binary-placeholder"] * 6),
    ("VersionRequest", {"expected_version": 1}, {"expected_version": 1, "status": "CLOSED"}),
    ("ResolveRequest", {"expected_version": 1, "resolution_note": "已修复"}, {"expected_version": 1}),
    ("ResolveRequest", {"expected_version": 1, "resolution_note": "已修复"}, {"expected_version": 1, "resolution_note": ""}),
    ("ReworkRequest", {"expected_version": 1, "reason": "仍有故障"}, {"expected_version": 1}),
    ("ReworkRequest", {"expected_version": 1, "reason": "仍有故障"}, {"expected_version": 1, "reason": ""}),
    ("StartRequest", {"expected_version": 1}, {"expected_version": 1, "status": "IN_PROGRESS"}),
    ("CancelRequest", {"expected_version": 1}, {"expected_version": 1, "reason": None}),
    ("AssignRequest", {"expected_version": 1, "technician_id": 2}, {"expected_version": 1, "technician_id": 0}),
    ("ReviewRequest", {"decision": "APPROVE", "expected_version": 1, "category": "HVAC", "priority": "LOW"}, {"decision": "APPROVE", "expected_version": 1, "category": "HVAC"}),
    ("ReviewRequest", {"decision": "REJECT", "expected_version": 1, "reason": "不在范围内"}, {"decision": "REJECT", "expected_version": 1, "reason": ""}),
    ("ReviewRequest", {"decision": "REJECT", "expected_version": 1, "reason": "不在范围内"}, {"decision": "REJECT", "expected_version": 1, "reason": "原因", "priority": "HIGH"}),
    ("CommentRequest", {"body": "留言", "visibility": "PUBLIC"}, {"body": "", "visibility": "PUBLIC"}),
    ("CommentRequest", {"body": "留言", "visibility": "ADMIN_ONLY"}, {"body": "x" * 2001, "visibility": "PUBLIC"}),
    ("UserActiveRequest", {"active": False}, {"active": False, "role": "ADMIN"}),
    ("UpdateLocationRequest", {"active": False}, {}),
    ("UpdateLocationRequest", {"floor": "3"}, {"floor": None}),
    ("CreateLocationRequest", {"building": "A", "floor": "3", "room_or_area": "301"}, {"building": "A", "floor": "", "room_or_area": "301"}),
])
def test_input_schemas_enforce_required_fields_and_boundaries(contract, schema_name, good, bad):
    validator = schema_validator(contract, schema_name)
    validator.validate(good)
    assert not validator.is_valid(bad)


@pytest.mark.parametrize("field,bad", [
    ("title", ""), ("title", "x" * 121), ("description", ""), ("description", "x" * 4001),
    ("category", "IT"), ("location_id", 0), ("photos", ["placeholder"] * 6),
    ("status", "CLOSED"), ("priority", "HIGH"),
])
def test_creation_does_not_allow_invalid_or_admin_owned_fields(contract, field, bad):
    validator = schema_validator(contract, "CreateTicketRequest")
    valid = {"title": "t" * 120, "description": "d" * 4000, "category": "HVAC", "location_id": 1}
    validator.validate(valid)
    assert not validator.is_valid({**valid, field: bad})


def test_review_is_discriminated_and_ticket_timeline_has_two_distinct_shapes(contract):
    review = contract["components"]["schemas"]["ReviewRequest"]
    assert review["discriminator"]["propertyName"] == "decision"
    assert set(review["discriminator"]["mapping"]) == {"APPROVE", "REJECT"}
    detail = contract["components"]["examples"]["TicketDetail"]["value"]
    validator = schema_validator(contract, "TicketDetail")
    validator.validate(detail)
    assert {item["kind"] for item in detail["timeline"]} == {"EVENT", "COMMENT"}
    invalid = deepcopy(detail)
    invalid["timeline"][0]["kind"] = "COMMENT"
    assert not validator.is_valid(invalid)


def test_ticket_fields_and_terminal_shapes_follow_database_baseline(contract):
    validator = schema_validator(contract, "TicketSummary")
    closed = contract["components"]["examples"]["ClosedTicket"]["value"]
    submitted = contract["components"]["examples"]["SubmittedTicket"]["value"]
    validator.validate(closed)
    validator.validate(submitted)
    assert not validator.is_valid({**closed, "priority": None})
    assert not validator.is_valid({**closed, "current_assignee": None})
    assert not validator.is_valid({**closed, "closed_at": None})
    assert not validator.is_valid({**closed, "allowed_actions": ["COMMENT_PUBLIC"]})
    assert not validator.is_valid({**submitted, "closed_at": "2026-10-02T08:00:00Z"})
    assert not validator.is_valid({**submitted, "storage_key": "private-file"})
    detail = contract["components"]["examples"]["TicketDetail"]["value"]
    assert not schema_validator(contract, "TicketDetail").is_valid({**detail, "password_hash": "secret"})


def test_cursor_pagination_and_filter_types_are_complete(contract):
    limit = contract["components"]["parameters"]["Limit"]["schema"]
    assert (limit["default"], limit["minimum"], limit["maximum"]) == (20, 1, 100)
    ticket_list = contract["paths"]["/api/tickets"]["get"]
    parameters = {value["name"]: value for value in (resolve(contract, p)[0] for p in ticket_list["parameters"])}
    assert set(parameters) == {"cursor", "limit", "status", "category", "priority", "building", "created_from", "created_before", "q", "current_assignee_id"}
    for name in ("TicketList", "LocationList", "UserList"):
        validator = schema_validator(contract, name)
        validator.validate({"items": [], "next_cursor": None})
        assert not validator.is_valid({"items": []})
    users = contract["paths"]["/api/admin/users"]["get"]
    user_parameters = {p["name"]: p for p in (resolve(contract, value)[0] for value in users["parameters"])}
    assert set(user_parameters) == {"cursor", "limit", "role", "active"}
    assert user_parameters["role"]["schema"] == {"$ref": "#/components/schemas/ManagedRole"}


def test_attachment_contract_has_private_download_and_only_business_uploads(contract):
    for path in ("/api/tickets", "/api/tickets/{id}/resolve"):
        operation = contract["paths"][path]["post"]
        assert set(operation["requestBody"]["content"]) == {"multipart/form-data"}
        assert {"413", "415", "422"} <= set(operation["responses"])
        encoding = operation["requestBody"]["content"]["multipart/form-data"]["encoding"]["photos"]
        assert {item.strip() for item in encoding["contentType"].split(",")} == {"image/jpeg", "image/png", "image/webp"}
    fields = contract["components"]["schemas"]["Attachment"]["properties"]
    assert fields["size"]["maximum"] == 5 * 1024 * 1024
    assert set(fields["mime"]["enum"]) == {"image/jpeg", "image/png", "image/webp"}
    assert "storage_key" not in fields
    download, _ = response(contract, contract["paths"]["/api/attachments/{id}"]["get"], "200")
    assert set(download["content"]) == {"image/jpeg", "image/png", "image/webp"}
    assert "Cache-Control" in download["headers"]


def test_analytics_empty_example_has_the_six_groups_and_continuous_thirty_days(contract):
    from datetime import date, timedelta

    empty = contract["components"]["examples"]["EmptyAnalytics"]["value"]
    schema_validator(contract, "Analytics").validate(empty)
    assert set(empty) == {"by_status", "by_category", "by_building", "backlog_count", "average_close_seconds", "daily_trend"}
    assert empty["backlog_count"] == 0
    dates = [date.fromisoformat(item["date"]) for item in empty["daily_trend"]]
    assert len(dates) == 30
    assert all(second - first == timedelta(days=1) for first, second in zip(dates, dates[1:]))
    assert all(item["created_count"] == item["closed_count"] == 0 for item in empty["daily_trend"])


def assert_runtime_error(contract, result, status, code, fields=False):
    assert result.status_code == status
    payload = result.json()
    schema_validator(contract, "ErrorResponse").validate(payload)
    assert payload["error"]["code"] == code
    assert result.headers["x-request-id"] == payload["error"]["request_id"]
    assert bool(payload["error"]["field_errors"]) is fields


def test_runtime_health_response_and_header_validate(contract):
    result = TestClient(create_app()).get("/health")
    assert result.status_code == 200
    schema_validator(contract, "Health").validate(result.json())
    assert result.headers["x-request-id"].startswith("req_")


@pytest.mark.parametrize("code,status", [
    ("VALIDATION_ERROR", 400), ("VALIDATION_ERROR", 413),
    ("VALIDATION_ERROR", 415), ("VALIDATION_ERROR", 422),
    ("UNAUTHORIZED", 401), ("FORBIDDEN", 403),
    ("NOT_FOUND", 404), ("CONFLICT", 409), ("TICKET_VERSION_CONFLICT", 409),
    ("ORIGIN_NOT_ALLOWED", 403), ("INTERNAL_ERROR", 500),
])
def test_core_app_errors_validate_against_contract_without_new_codes(contract, code, status):
    app = create_app()

    @app.get("/contract-test-error")
    def raise_expected_error():
        raise AppError(
            code=ErrorCode(code), status_code=status, message="Safe test message.",
            field_errors=[{"field": "title", "message": "Field required", "type": "missing"}] if status == 422 else None,
        )

    result = TestClient(app).get("/contract-test-error")
    assert_runtime_error(contract, result, status, code, fields=status == 422)


@pytest.mark.parametrize("origin", [None, "https://attacker.example.invalid"])
def test_core_origin_rejections_validate_before_route_handling(contract, origin):
    headers = {} if origin is None else {"Origin": origin}
    result = TestClient(create_app()).post("/api/auth/login", json={}, headers=headers)
    assert_runtime_error(contract, result, 403, "ORIGIN_NOT_ALLOWED")


def test_core_validation_error_fields_validate_against_contract(contract):
    class Payload(BaseModel):
        title: str

    app = create_app()

    @app.post("/contract-test-validation")
    def validate_payload(payload: Payload = Body(...)):
        return payload

    result = TestClient(app).post("/contract-test-validation", json={}, headers={"Origin": get_settings().allowed_origins[0]})
    assert_runtime_error(contract, result, 422, "VALIDATION_ERROR", fields=True)
    assert result.json()["error"]["field_errors"][0]["field"] == "title"


@pytest.mark.parametrize("status,code", [
    (401, "UNAUTHORIZED"), (403, "FORBIDDEN"), (404, "NOT_FOUND"),
])
def test_core_supported_http_errors_reuse_existing_codes(contract, status, code):
    app = create_app()

    @app.get("/contract-test-http-error")
    def raise_http_error():
        raise HTTPException(status_code=status, detail="Safe test message.")

    result = TestClient(app).get("/contract-test-http-error")
    assert_runtime_error(contract, result, status, code)


def test_core_unexpected_exceptions_are_safe_and_conformant(contract):
    app = create_app()

    @app.get("/contract-test-unexpected")
    def raise_unexpected_error():
        raise RuntimeError("private SQL and database password")

    result = TestClient(app, raise_server_exceptions=False).get("/contract-test-unexpected")
    assert_runtime_error(contract, result, 500, "INTERNAL_ERROR")
    assert "SQL" not in result.text and "password" not in result.text
