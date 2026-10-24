"""Pure field-model tests; not evidence of live Issue #51 API behavior."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import get_args

import pytest
import yaml
from pydantic import ValidationError

from app.modules.tickets.schemas import (
    CreateTicketFields,
    TicketCategory,
    TicketListFilters,
    TicketPriority,
    TicketStatus,
)


def create_fields(**changes):
    fields = {
        "title": "教室照明闪烁",
        "description": "灯具持续闪烁。",
        "category": "LIGHTING_ELECTRICAL",
        "location_id": 1,
    }
    fields.update(changes)
    return fields


def test_field_constraints_match_existing_contract_fields():
    contract_path = Path(__file__).resolve().parents[2] / "docs/api/openapi.yaml"
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    schemas = contract["components"]["schemas"]
    fields = schemas["CreateTicketRequest"]["properties"]
    assert get_args(TicketCategory) == tuple(schemas["Category"]["enum"])
    assert get_args(TicketStatus) == tuple(schemas["TicketStatus"]["enum"])
    assert get_args(TicketPriority) == tuple(schemas["Priority"]["enum"])
    internal = CreateTicketFields.model_json_schema()["properties"]
    for name in ("title", "description"):
        assert internal[name]["minLength"] == fields[name]["minLength"]
        assert internal[name]["maxLength"] == fields[name]["maxLength"]
    parameters = contract["components"]["parameters"]
    limit = TicketListFilters.model_json_schema()["properties"]["limit"]
    assert limit["default"] == parameters["Limit"]["schema"]["default"]
    assert limit["minimum"] == parameters["Limit"]["schema"]["minimum"]
    assert limit["maximum"] == parameters["Limit"]["schema"]["maximum"]


@pytest.mark.parametrize("category", get_args(TicketCategory))
def test_create_accepts_each_baseline_category(category):
    fields = CreateTicketFields(**create_fields(category=category))
    assert fields.category == category
    assert fields.location_id == 1


@pytest.mark.parametrize("length", [1, 120])
def test_create_title_valid_boundaries(length):
    assert len(CreateTicketFields(**create_fields(title="题" * length)).title) == length


@pytest.mark.parametrize("length", [1, 4000])
def test_create_description_valid_boundaries(length):
    fields = CreateTicketFields(**create_fields(description="述" * length))
    assert len(fields.description) == length


@pytest.mark.parametrize(
    "name,value",
    [
        ("title", ""),
        ("title", "题" * 121),
        ("description", ""),
        ("description", "述" * 4001),
        ("category", "OTHER"),
        ("location_id", 0),
        ("location_id", -1),
        ("location_id", True),
        ("location_id", False),
        ("location_id", 1.5),
        ("location_id", 1.0),
        ("location_id", None),
    ],
)
def test_create_rejects_invalid_fields(name, value):
    with pytest.raises(ValidationError) as error:
        CreateTicketFields(**create_fields(**{name: value}))
    assert error.value.errors()[0]["loc"] == (name,)


@pytest.mark.parametrize("name", ["title", "description", "category", "location_id"])
def test_create_requires_all_four_fields(name):
    fields = create_fields()
    del fields[name]
    with pytest.raises(ValidationError) as error:
        CreateTicketFields(**fields)
    assert error.value.errors()[0]["loc"] == (name,)


def test_create_does_not_strip_or_add_whitespace_business_rules():
    fields = CreateTicketFields(**create_fields(title=" ", description="  文本  "))
    assert fields.title == " "
    assert fields.description == "  文本  "


def test_create_can_parse_multipart_integer_text():
    assert CreateTicketFields(**create_fields(location_id="12")).location_id == 12


@pytest.mark.parametrize("identifier", [2**63 - 1, str(2**63 - 1)])
def test_create_accepts_maximum_int64_id(identifier):
    fields = CreateTicketFields(**create_fields(location_id=identifier))
    assert fields.location_id == 2**63 - 1


@pytest.mark.parametrize("identifier", [2**63, str(2**63)])
def test_create_rejects_ids_above_int64_range(identifier):
    with pytest.raises(ValidationError) as error:
        CreateTicketFields(**create_fields(location_id=identifier))
    assert error.value.errors()[0]["loc"] == ("location_id",)


def test_create_fields_do_not_accept_unowned_use_case_inputs():
    with pytest.raises(ValidationError):
        CreateTicketFields(**create_fields(status="SUBMITTED"))


def test_list_defaults_leave_all_filters_unset():
    fields = TicketListFilters()
    assert fields.limit == 20
    assert all(value is None for name, value in fields.model_dump().items() if name != "limit")


def test_list_contains_all_seven_filter_groups_and_pagination():
    fields = TicketListFilters(
        status="SUBMITTED",
        category="LIGHTING_ELECTRICAL",
        priority="HIGH",
        building="教学楼A",
        created_from="2026-10-02T00:00:00Z",
        created_before="2026-10-03T00:00:00Z",
        q="CF-20261002",
        current_assignee_id="2",
        cursor="opaque-example",
        limit="100",
    )
    assert fields.status == "SUBMITTED"
    assert fields.category == "LIGHTING_ELECTRICAL"
    assert fields.priority == "HIGH"
    assert fields.building == "教学楼A"
    assert fields.created_from == datetime(2026, 10, 2, tzinfo=timezone.utc)
    assert fields.created_before == datetime(2026, 10, 3, tzinfo=timezone.utc)
    assert fields.q == "CF-20261002"
    assert fields.current_assignee_id == 2
    assert fields.cursor == "opaque-example"
    assert fields.limit == 100


@pytest.mark.parametrize("name,values", [
    ("status", get_args(TicketStatus)),
    ("category", get_args(TicketCategory)),
    ("priority", get_args(TicketPriority)),
])
def test_list_accepts_all_baseline_enum_values(name, values):
    for value in values:
        assert getattr(TicketListFilters(**{name: value}), name) == value


@pytest.mark.parametrize("limit", [1, 20, 100, "1", "20", "100"])
def test_list_limit_boundaries_and_query_text(limit):
    assert TicketListFilters(limit=limit).limit == int(limit)


@pytest.mark.parametrize("identifier", [2**63 - 1, str(2**63 - 1)])
def test_list_accepts_maximum_int64_assignee_id(identifier):
    assert TicketListFilters(current_assignee_id=identifier).current_assignee_id == 2**63 - 1


@pytest.mark.parametrize("identifier", [2**63, str(2**63)])
def test_list_rejects_assignee_ids_above_int64_range(identifier):
    with pytest.raises(ValidationError) as error:
        TicketListFilters(current_assignee_id=identifier)
    assert error.value.errors()[0]["loc"] == ("current_assignee_id",)


@pytest.mark.parametrize(
    "name,value",
    [
        ("limit", 0),
        ("limit", 101),
        ("limit", True),
        ("limit", 1.5),
        ("limit", "invalid"),
        ("current_assignee_id", 0),
        ("current_assignee_id", -1),
        ("current_assignee_id", True),
        ("current_assignee_id", 1.5),
        ("status", "INVALID"),
        ("category", "INVALID"),
        ("priority", "URGENT"),
        ("building", ""),
        ("q", ""),
        ("cursor", ""),
    ],
)
def test_list_rejects_invalid_filter_fields(name, value):
    with pytest.raises(ValidationError) as error:
        TicketListFilters(**{name: value})
    assert error.value.errors()[0]["loc"] == (name,)


@pytest.mark.parametrize("name", ["created_from", "created_before"])
def test_list_accepts_utc_aware_internal_datetimes(name):
    timestamp = datetime(2026, 10, 2, 12, 30, 15, 123456, tzinfo=timezone.utc)
    assert getattr(TicketListFilters(**{name: timestamp}), name) == timestamp


@pytest.mark.parametrize("name", ["created_from", "created_before"])
@pytest.mark.parametrize(
    "timestamp",
    [
        "2026-10-02T08:00:00",
        "2026-10-02T08:00:00+00:00",
        "2026-10-02T08:00:00+08:00",
        "not-a-dateZ",
        datetime(2026, 10, 2, 8),
        datetime(2026, 10, 2, 8, tzinfo=timezone(timedelta(hours=8))),
        1790928000,
        True,
    ],
)
def test_list_rejects_non_z_text_naive_or_non_utc_datetimes(name, timestamp):
    with pytest.raises(ValidationError) as error:
        TicketListFilters(**{name: timestamp})
    assert error.value.errors()[0]["loc"] == (name,)


def test_list_keeps_keyword_text_without_defining_matching_rules():
    assert TicketListFilters(q="  灯  ").q == "  灯  "
