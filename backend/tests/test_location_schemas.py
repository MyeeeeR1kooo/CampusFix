"""Location input and cursor boundaries from the frozen API contract."""

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.core.errors import AppError
from app.modules.locations.cursor import decode_cursor, encode_cursor
from app.modules.locations.schemas import (
    CreateLocationRequest,
    LocationListResponse,
    LocationResponse,
    UpdateLocationRequest,
)
from app.modules.users.cursor import encode_cursor as encode_account_cursor


ADDRESS = {"building": "示例楼", "floor": "3", "room_or_area": "301"}
CREATED_AT = datetime(2026, 10, 10, 3, 20, tzinfo=timezone.utc)
SECRET = "location-test-secret"


def test_creation_defaults_active_and_keeps_all_input_text():
    payload = {"building": " 示例楼 ", "floor": " 3 ", "room_or_area": " 301 "}
    request = CreateLocationRequest.model_validate(payload)
    assert request.model_dump() == {**payload, "active": True}


@pytest.mark.parametrize("field", ADDRESS)
@pytest.mark.parametrize("invalid", [None, "", 1, True, [], {}])
def test_creation_rejects_invalid_location_text(field, invalid):
    with pytest.raises(ValidationError):
        CreateLocationRequest.model_validate({**ADDRESS, field: invalid})


@pytest.mark.parametrize("field", ADDRESS)
def test_creation_requires_each_address_part(field):
    payload = ADDRESS.copy()
    del payload[field]
    with pytest.raises(ValidationError):
        CreateLocationRequest.model_validate(payload)


@pytest.mark.parametrize("invalid", [None, "true", "false", 0, 1])
def test_creation_active_requires_a_json_boolean(invalid):
    with pytest.raises(ValidationError):
        CreateLocationRequest.model_validate({**ADDRESS, "active": invalid})


@pytest.mark.parametrize("payload", [
    {**ADDRESS, "id": 1},
    {**ADDRESS, "created_at": CREATED_AT.isoformat()},
    {**ADDRESS, "unknown": "value"},
])
def test_creation_rejects_server_owned_and_unknown_fields(payload):
    with pytest.raises(ValidationError):
        CreateLocationRequest.model_validate(payload)


@pytest.mark.parametrize("payload", [
    {},
    {"building": None},
    {"floor": None},
    {"room_or_area": None},
    {"active": None},
    {"building": ""},
    {"floor": ""},
    {"room_or_area": ""},
    {"floor": 3},
    {"active": "false"},
    {"active": 0},
    {"id": 1},
    {"building": "新楼", "active": True, "unknown": "value"},
])
def test_partial_update_rejects_empty_null_invalid_and_extra_fields(payload):
    with pytest.raises(ValidationError):
        UpdateLocationRequest.model_validate(payload)


@pytest.mark.parametrize("payload", [
    {"building": "新楼"},
    {"floor": "4"},
    {"room_or_area": "区域"},
    {"active": False},
    {**ADDRESS, "active": True},
])
def test_partial_update_contains_only_explicitly_provided_fields(payload):
    request = UpdateLocationRequest.model_validate(payload)
    assert request.model_dump(exclude_unset=True) == payload


def test_nonempty_whitespace_remains_accepted_without_an_unapproved_normalization_rule():
    payload = {"building": " ", "floor": "\t", "room_or_area": "\n"}
    assert CreateLocationRequest.model_validate(payload).model_dump() == {**payload, "active": True}
    assert UpdateLocationRequest.model_validate(payload).model_dump(exclude_unset=True) == payload


def test_location_response_serializes_utc_and_has_only_contract_fields():
    offset_time = datetime(2026, 10, 10, 11, 20, tzinfo=timezone(timedelta(hours=8)))
    response = LocationResponse(
        id=1, **ADDRESS, active=False, created_at=offset_time, updated_at=offset_time,
    )
    public = response.model_dump(mode="json")
    assert set(public) == {"id", "building", "floor", "room_or_area", "active", "created_at", "updated_at"}
    assert public["created_at"] == public["updated_at"] == "2026-10-10T03:20:00Z"
    listing = LocationListResponse(items=[response], next_cursor=None).model_dump(mode="json")
    assert set(listing) == {"items", "next_cursor"}
    assert listing == {"items": [public], "next_cursor": None}


@pytest.mark.parametrize("active_only", [True, False])
def test_cursor_round_trip_is_bound_to_the_location_list_scope(active_only):
    token = encode_cursor(CREATED_AT, 7, active_only, SECRET)
    assert decode_cursor(token, active_only, SECRET) == (CREATED_AT, 7)
    with pytest.raises(AppError) as exc:
        decode_cursor(token, not active_only, SECRET)
    assert (exc.value.status_code, exc.value.code) == (400, "VALIDATION_ERROR")


@pytest.mark.parametrize("candidate", ["", "not a cursor", "!invalid!", "A", "x" * 1025])
def test_malformed_cursor_is_a_safe_400(candidate):
    with pytest.raises(AppError) as exc:
        decode_cursor(candidate, True, SECRET)
    assert (exc.value.status_code, exc.value.code) == (400, "VALIDATION_ERROR")


def test_cursor_rejects_a_modified_signature_wrong_secret_and_other_resources():
    token = encode_cursor(CREATED_AT, 7, True, SECRET)
    changed = "A" if token[10] != "A" else "B"
    account_token = encode_account_cursor(CREATED_AT, 7, None, None, SECRET)
    for candidate, secret in (
        (token[:10] + changed + token[11:], SECRET),
        (token, "another-secret"),
        (account_token, SECRET),
    ):
        with pytest.raises(AppError) as exc:
            decode_cursor(candidate, True, secret)
        assert (exc.value.status_code, exc.value.code) == (400, "VALIDATION_ERROR")


def signed_payload(payload):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(SECRET.encode(), raw, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(raw + signature).decode().rstrip("=")


@pytest.mark.parametrize("changed_fields", [
    {"id": 0},
    {"id": -1},
    {"id": True},
    {"id": "1"},
    {"id": 2**63},
    {"created_at": "not-a-date"},
    {"created_at": "2026-10-10T03:20:00"},
    {"active_only": 1},
    {"active_only": "true"},
    {"resource": "users"},
    {"unexpected": True},
])
def test_signed_cursor_still_validates_its_exact_payload(changed_fields):
    payload = {
        "resource": "locations", "created_at": CREATED_AT.isoformat(),
        "id": 7, "active_only": True,
    }
    token = signed_payload({**payload, **changed_fields})
    with pytest.raises(AppError) as exc:
        decode_cursor(token, True, SECRET)
    assert (exc.value.status_code, exc.value.code) == (400, "VALIDATION_ERROR")


@pytest.mark.parametrize("payload", [[], None, {}, b"\xff", b"{"])
def test_signed_cursor_with_an_invalid_json_object_returns_400(payload):
    with pytest.raises(AppError) as exc:
        decode_cursor(signed_payload(payload), True, SECRET)
    assert (exc.value.status_code, exc.value.code) == (400, "VALIDATION_ERROR")
