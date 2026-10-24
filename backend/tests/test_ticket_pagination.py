"""Pure cursor tests and PostgreSQL expression compilation; no database tests."""

import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import BigInteger, DateTime, column, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import operators

from app.core.errors import AppError
from app.modules.tickets.pagination import (
    CursorPosition, decode_ticket_cursor, encode_ticket_cursor,
    ticket_seek_predicate,
)


SECRET = "isolated-test-cursor-secret"
STAMP = datetime(2026, 10, 4, 1, 2, 3, 456789, tzinfo=timezone.utc)
POSITION = CursorPosition(STAMP, 42)
FILTERS = {
    "status": "SUBMITTED", "category": "LIGHTING_ELECTRICAL",
    "priority": "HIGH", "building": "演示楼 A",
    "created_from": datetime(2026, 10, 1, tzinfo=timezone.utc),
    "created_before": datetime(2026, 10, 5, tzinfo=timezone.utc),
    "q": "原始 标题", "current_assignee_id": 17,
}


def scope(**overrides):
    result = {"secret_key": SECRET, "user_id": 7, "role": "ADMIN", "filters": FILTERS}
    result.update(overrides)
    return result


def cursor():
    return encode_ticket_cursor(POSITION, **scope())


def assert_bad(value, **overrides):
    with pytest.raises(AppError) as raised:
        decode_ticket_cursor(value, **scope(**overrides))
    assert raised.value.code == "VALIDATION_ERROR"
    assert raised.value.status_code == 400
    assert raised.value.message == "Invalid pagination cursor."
    assert raised.value.field_errors == []


def payload(value):
    encoded = value.split(".")[0]
    return json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))


def sign_bytes(value):
    encoded = base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")
    digest = hmac.new(SECRET.encode(), b"CampusFix:tickets:list:cursor:v1\x00" + encoded.encode(), hashlib.sha256).digest()
    return encoded + "." + base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def sign_payload(value):
    return sign_bytes(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def test_round_trip_preserves_utc_microseconds_and_bigint():
    position = CursorPosition(STAMP, 2**63 - 1)
    result = decode_ticket_cursor(encode_ticket_cursor(position, **scope()), **scope())
    assert result == position
    assert result.created_at.tzinfo is timezone.utc
    assert result.created_at.microsecond == 456789


def test_non_utc_position_is_normalized_without_changing_the_instant():
    position = CursorPosition(STAMP.astimezone(timezone(timedelta(hours=8))), 42)
    assert encode_ticket_cursor(position, **scope()) == cursor()
    assert decode_ticket_cursor(cursor(), **scope()) == POSITION


def test_scope_is_independent_of_filter_dictionary_order():
    reversed_filters = dict(reversed(list(FILTERS.items())))
    assert encode_ticket_cursor(POSITION, **scope(filters=reversed_filters)) == cursor()
    assert decode_ticket_cursor(cursor(), **scope(filters=reversed_filters)) == POSITION


def test_unset_none_filters_equal_omitted_filters():
    value = encode_ticket_cursor(POSITION, **scope(filters={}))
    assert decode_ticket_cursor(value, **scope(filters={"q": None, "status": None})) == POSITION


def test_filter_datetimes_use_the_same_utc_instant():
    filters = {**FILTERS, "created_from": FILTERS["created_from"].astimezone(timezone(timedelta(hours=8)))}
    assert decode_ticket_cursor(cursor(), **scope(filters=filters)) == POSITION


def test_payload_does_not_contain_plaintext_principal_filters_or_secret():
    data = payload(cursor())
    assert set(data) == {"v", "created_at", "id", "scope"}
    assert isinstance(data["scope"], str) and len(data["scope"]) == 64
    assert SECRET not in json.dumps(data)
    assert FILTERS["q"] not in json.dumps(data, ensure_ascii=False)
    assert "user_id" not in data and "role" not in data and "filters" not in data


@pytest.mark.parametrize("role", ["REPORTER", "TECHNICIAN", "ADMIN"])
def test_all_valid_roles_can_have_their_own_cursor(role):
    value = encode_ticket_cursor(POSITION, **scope(role=role, filters={}))
    assert decode_ticket_cursor(value, **scope(role=role, filters={})) == POSITION


@pytest.mark.parametrize("changes", [
    {"user_id": 8}, {"role": "REPORTER"}, {"role": "TECHNICIAN"},
    {"secret_key": "another-isolated-test-key"},
])
def test_cursor_is_bound_to_user_role_and_signing_key(changes):
    assert_bad(cursor(), **changes)


@pytest.mark.parametrize("name,replacement", [
    ("status", "CLOSED"), ("category", "FURNITURE"), ("priority", "LOW"),
    ("building", "演示楼 B"), ("created_from", STAMP),
    ("created_before", STAMP), ("q", "另一个标题"), ("current_assignee_id", 18),
])
def test_every_nonempty_filter_is_bound(name, replacement):
    assert_bad(cursor(), filters={**FILTERS, name: replacement})


@pytest.mark.parametrize("name", list(FILTERS))
def test_removing_a_filter_is_rejected(name):
    assert_bad(cursor(), filters={key: value for key, value in FILTERS.items() if key != name})


def test_raw_keyword_is_not_trimmed_or_given_a_matching_policy():
    assert_bad(cursor(), filters={**FILTERS, "q": " 原始 标题 "})


@pytest.mark.parametrize("value", [None, True, 1, b"not-a-cursor", [], {}, "", ".", "one", "one.two.three", "!.*", "A.A", "=" * 1000])
def test_malformed_types_encoding_and_length_are_rejected(value):
    assert_bad(value)


def test_signature_tampering_is_rejected():
    encoded, signature = cursor().split(".")
    changed = ("A" if signature[0] != "A" else "B") + signature[1:]
    assert_bad(encoded + "." + changed)


def test_position_tampering_without_resigning_is_rejected():
    value = cursor()
    data = payload(value)
    data["id"] += 1
    encoded = sign_payload(data).split(".")[0]
    assert_bad(encoded + "." + value.split(".")[1])


@pytest.mark.parametrize("bad", [False, True, 0, -1, 1.5, "42", None, [], 2**63])
def test_even_signed_payloads_cannot_supply_an_invalid_id(bad):
    data = payload(cursor())
    data["id"] = bad
    assert_bad(sign_payload(data))


@pytest.mark.parametrize("bad", [True, False, 0, 2, "1", None])
def test_even_signed_payloads_need_the_supported_integer_version(bad):
    data = payload(cursor())
    data["v"] = bad
    assert_bad(sign_payload(data))


@pytest.mark.parametrize("bad", [
    "2026-10-04T01:02:03.456789", "2026-10-04T01:02:03.456789+00:00",
    "2026-10-04T01:02:03Z", "2026-99-04T01:02:03.456789Z",
    "not-a-time", 1, None, [],
])
def test_even_signed_payloads_need_a_canonical_aware_utc_time(bad):
    data = payload(cursor())
    data["created_at"] = bad
    assert_bad(sign_payload(data))


@pytest.mark.parametrize("bad", [None, 1, [], "x", "f" * 64, "é" * 64])
def test_even_signed_payloads_need_a_matching_valid_scope(bad):
    data = payload(cursor())
    data["scope"] = bad
    assert_bad(sign_payload(data))


@pytest.mark.parametrize("value", [b"{", b"[]", b"null", b"\xff", b'{"v":1}'])
def test_signed_invalid_json_or_structure_is_rejected(value):
    assert_bad(sign_bytes(value))


def test_signed_extra_field_is_rejected():
    data = payload(cursor())
    data["unexpected"] = "not-part-of-the-position"
    assert_bad(sign_payload(data))


def test_duplicate_json_field_is_rejected_even_with_a_valid_signature():
    data = payload(cursor())
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":"))
    duplicated = encoded[:-1] + ',"v":1}'
    assert_bad(sign_bytes(duplicated.encode()))


@pytest.mark.parametrize("stamp,ticket_id", [
    (STAMP.replace(tzinfo=None), 1), ("2026-10-04", 1),
    (STAMP, True), (STAMP, 0), (STAMP, -1), (STAMP, 2**63),
])
def test_internal_positions_require_aware_time_and_positive_bigint(stamp, ticket_id):
    with pytest.raises(ValueError):
        CursorPosition(stamp, ticket_id)


@pytest.mark.parametrize("changes", [
    {"secret_key": ""}, {"user_id": True}, {"user_id": 0}, {"role": "GUEST"},
    {"filters": {"limit": 20}}, {"filters": {"q": []}},
    {"filters": {"created_from": STAMP.replace(tzinfo=None)}},
])
def test_trusted_caller_input_is_not_silently_guessed(changes):
    with pytest.raises(ValueError):
        encode_ticket_cursor(POSITION, **scope(**changes))


def test_postgresql_seek_expression_uses_both_columns_without_running_sql():
    tickets = table("tickets", column("created_at", DateTime(timezone=True)), column("id", BigInteger))
    predicate = ticket_seek_predicate(tickets.c.created_at, tickets.c.id, POSITION)
    compiled = predicate.compile(dialect=postgresql.dialect())
    assert str(compiled) == (
        "tickets.created_at < %(created_at_1)s::TIMESTAMP WITH TIME ZONE OR "
        "tickets.created_at = %(created_at_2)s::TIMESTAMP WITH TIME ZONE "
        "AND tickets.id < %(id_1)s::BIGINT"
    )
    assert compiled.params == {"created_at_1": STAMP, "created_at_2": STAMP, "id_1": 42}


def test_equal_timestamp_seek_requires_a_strictly_smaller_id():
    tickets = table("tickets", column("created_at", DateTime(timezone=True)), column("id", BigInteger))
    predicate = ticket_seek_predicate(tickets.c.created_at, tickets.c.id, POSITION)
    assert predicate.operator is operators.or_
    older_time, same_time_then_lower_id = tuple(predicate.clauses)
    assert older_time.operator is operators.lt
    equality, lower_id = tuple(same_time_then_lower_id.clauses)
    assert equality.operator is operators.eq and equality.right.value == STAMP
    assert lower_id.left is tickets.c.id and lower_id.operator is operators.lt
    assert lower_id.right.value == 42


def test_seek_normalizes_offset_time_and_accepts_supplied_column_names():
    events = table("custom_source", column("time_key", DateTime(timezone=True)), column("row_key", BigInteger))
    offset = CursorPosition(STAMP.astimezone(timezone(timedelta(hours=8))), 42)
    compiled = ticket_seek_predicate(events.c.time_key, events.c.row_key, offset).compile(dialect=postgresql.dialect())
    assert "custom_source.time_key" in str(compiled) and "custom_source.row_key" in str(compiled)
    assert compiled.params["time_key_1"].tzinfo is timezone.utc
    assert compiled.params["time_key_1"] == STAMP
