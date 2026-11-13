"""Pure response-shape evidence, not HTTP, authorization or Workflow evidence."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from pydantic import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from app.modules.tickets.responses import (
    TicketDetailResponse,
    TicketListResponse,
    TicketSummaryResponse,
)


CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs/api/openapi.yaml"
CONTRACT_URI = "urn:campusfix:ticket-responses"
SUMMARY_EXAMPLES = (
    "SubmittedTicket", "ApprovedTicket", "RejectedTicket", "AssignedTicket",
    "StartedTicket", "ResolvedTicket", "ReworkedTicket", "ClosedTicket",
    "CancelledTicket",
)
WORKFLOW_FIELDS = ("current_responsible_role", "next_action", "allowed_actions")


@pytest.fixture(scope="module")
def response_contract():
    return yaml.safe_load(CONTRACT_PATH.read_text(encoding="utf-8"))


def example(contract, name):
    return deepcopy(contract["components"]["examples"][name]["value"])


def assert_contract(contract, payload, schema_name):
    registry = Registry().with_resource(
        CONTRACT_URI, Resource.from_contents(contract, default_specification=DRAFT202012)
    )
    Draft202012Validator(
        {"$ref": f"{CONTRACT_URI}#/components/schemas/{schema_name}"},
        registry=registry,
        format_checker=FormatChecker(),
    ).validate(payload)


@pytest.mark.parametrize("name", SUMMARY_EXAMPLES)
def test_summary_examples_round_trip_and_match_frozen_schema(response_contract, name):
    payload = example(response_contract, name)
    output = TicketSummaryResponse.model_validate(payload).model_dump(mode="json")
    assert output == payload
    assert_contract(response_contract, output, "TicketSummary")


@pytest.mark.parametrize("name", ("TicketDetail", "PendingConfirmationDetail"))
def test_detail_examples_round_trip_and_match_frozen_schema(response_contract, name):
    payload = example(response_contract, name)
    output = TicketDetailResponse.model_validate(payload).model_dump(mode="json")
    assert output == payload
    assert_contract(response_contract, output, "TicketDetail")


def test_list_and_empty_page_match_frozen_schema(response_contract):
    for payload in (example(response_contract, "TicketList"), {"items": [], "next_cursor": None}):
        output = TicketListResponse.model_validate(payload).model_dump(mode="json")
        assert output == payload
        assert_contract(response_contract, output, "TicketList")
    with pytest.raises(ValidationError):
        TicketListResponse.model_validate({"items": []})


def test_every_public_field_is_required_including_nullable_workflow_fields(response_contract):
    cases = (
        (TicketSummaryResponse, "SubmittedTicket"),
        (TicketDetailResponse, "PendingConfirmationDetail"),
        (TicketListResponse, "TicketList"),
    )
    for model, name in cases:
        payload = example(response_contract, name)
        assert set(model.model_json_schema()["required"]) == set(payload)
        for field in payload:
            incomplete = deepcopy(payload)
            del incomplete[field]
            with pytest.raises(ValidationError):
                model.model_validate(incomplete)
    incomplete = example(response_contract, "SubmittedTicket")
    for field in WORKFLOW_FIELDS:
        del incomplete[field]
    with pytest.raises(ValidationError):
        TicketSummaryResponse.model_validate(incomplete)


def test_summary_rejects_unknown_enums_duplicate_actions_and_non_json_integer_ids(response_contract):
    payload = example(response_contract, "SubmittedTicket")
    invalid_fields = {
        "id": (True, "1", 1.0, 0, -1),
        "location_id": (False, "1", 0),
        "version": (True, "1", 0),
        "code": ("1", "CF-20261002-00001"),
        "status": ("UNKNOWN",),
        "category": ("UNKNOWN",),
        "priority": ("URGENT",),
        "current_responsible_role": ("UNKNOWN",),
        "next_action": ("CANCEL",),
        "allowed_actions": (["UNKNOWN"], ["CANCEL", "CANCEL"]),
        "title": ("", "x" * 121),
    }
    for field, values in invalid_fields.items():
        for value in values:
            with pytest.raises(ValidationError):
                TicketSummaryResponse.model_validate({**payload, field: value})


def test_state_dependent_priority_assignee_and_closed_at_contract(response_contract):
    for name in ("ApprovedTicket", "AssignedTicket", "StartedTicket", "ResolvedTicket", "ClosedTicket"):
        payload = example(response_contract, name)
        with pytest.raises(ValidationError):
            TicketSummaryResponse.model_validate({**payload, "priority": None})
    for name in ("AssignedTicket", "StartedTicket", "ResolvedTicket", "ClosedTicket"):
        payload = example(response_contract, name)
        for assignee in (None, {"id": 2, "name": "Wrong role", "role": "REPORTER"}):
            with pytest.raises(ValidationError):
                TicketSummaryResponse.model_validate({**payload, "current_assignee": assignee})
    assignee = example(response_contract, "AssignedTicket")["current_assignee"]
    for name in ("SubmittedTicket", "ApprovedTicket", "RejectedTicket", "CancelledTicket"):
        with pytest.raises(ValidationError):
            TicketSummaryResponse.model_validate({**example(response_contract, name), "current_assignee": assignee})
    with pytest.raises(ValidationError):
        TicketSummaryResponse.model_validate({**example(response_contract, "ClosedTicket"), "closed_at": None})
    for name in SUMMARY_EXAMPLES:
        if name != "ClosedTicket":
            with pytest.raises(ValidationError):
                TicketSummaryResponse.model_validate({**example(response_contract, name), "closed_at": "2026-10-02T10:00:00Z"})


def test_terminal_workflow_fields_must_be_null_and_actions_empty(response_contract):
    for name in ("ClosedTicket", "RejectedTicket", "CancelledTicket"):
        payload = example(response_contract, name)
        for field, value in (
            ("current_responsible_role", "ADMIN"),
            ("next_action", "REVIEW"),
            ("allowed_actions", ["COMMENT_PUBLIC"]),
        ):
            with pytest.raises(ValidationError):
                TicketSummaryResponse.model_validate({**payload, field: value})


def test_aware_timestamps_serialize_to_z_and_invalid_wire_timestamps_are_rejected(response_contract):
    payload = example(response_contract, "SubmittedTicket")
    shanghai = timezone(timedelta(hours=8))
    payload["created_at"] = datetime(2026, 10, 2, 16, tzinfo=shanghai)
    output = TicketSummaryResponse.model_validate(payload).model_dump(mode="json")
    assert output["created_at"] == "2026-10-02T08:00:00Z"
    assert_contract(response_contract, output, "TicketSummary")
    for value in (
        "2026-10-02T08:00:00", "2026-10-02T08:00:00+00:00",
        datetime(2026, 10, 2, 8), 1790928000,
    ):
        with pytest.raises(ValidationError):
            TicketSummaryResponse.model_validate({**payload, "created_at": value})


def test_extra_fields_and_sensitive_nested_data_are_rejected(response_contract):
    payload = example(response_contract, "PendingConfirmationDetail")
    for field in ("email", "password_hash", "token_hash", "storage_key", "disk_path"):
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate({**payload, field: "private"})
        nested = deepcopy(payload)
        nested["reporter"][field] = "private"
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate(nested)
    for branch, field in (("report_photos", "storage_key"), ("assignments", "private"), ("timeline", "private")):
        nested = deepcopy(payload)
        nested[branch][0][field] = "private"
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate(nested)
    with pytest.raises(ValidationError):
        TicketListResponse.model_validate({"items": [], "next_cursor": None, "total": 0})


def test_timeline_kind_is_discriminated_and_event_enums_and_comment_bounds_are_checked(response_contract):
    payload = example(response_contract, "TicketDetail")
    event, comment = payload["timeline"]
    malformed_entries = [
        {**event, "kind": "UNKNOWN"}, {**event, "kind": "COMMENT"},
        {key: value for key, value in event.items() if key != "kind"},
        {**event, "type": "UNKNOWN"}, {**event, "visibility": "PRIVATE"},
        {**event, "to_status": "UNKNOWN"}, {**comment, "body": ""},
        {**comment, "body": "x" * 2001},
    ]
    for entry in malformed_entries:
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate({**payload, "timeline": [entry]})
    generated = TicketDetailResponse.model_json_schema()
    assert generated["properties"]["timeline"]["items"]["discriminator"]["propertyName"] == "kind"


def test_photo_metadata_bounds_relative_download_and_p0_assignment_end(response_contract):
    payload = example(response_contract, "PendingConfirmationDetail")
    photo = payload["report_photos"][0]
    for field, value in (
        ("size", 0), ("size", 5242881), ("size", True),
        ("mime", "image/gif"), ("purpose", "UNKNOWN"),
        ("download_url", "https://example.invalid/public.png"),
        ("download_url", "/api/attachments/0"),
    ):
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate({**payload, "report_photos": [{**photo, field: value}]})
    for branch in ("report_photos", "resolution_photos"):
        five = {**payload, branch: [deepcopy(payload[branch][0]) for _ in range(5)]}
        assert_contract(response_contract, TicketDetailResponse.model_validate(five).model_dump(mode="json"), "TicketDetail")
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate({**five, branch: five[branch] + [deepcopy(five[branch][0])]})
    assignment = payload["assignments"][0]
    with pytest.raises(ValidationError):
        TicketDetailResponse.model_validate({**payload, "assignments": [{**assignment, "ended_at": "2026-10-02T10:00:00Z"}]})


def test_nullable_fields_do_not_replace_scalar_or_list_type_validation(response_contract):
    payload = example(response_contract, "SubmittedTicket")
    for field, value in (("allowed_actions", "CANCEL"), ("allowed_actions", None), ("title", 7)):
        with pytest.raises(ValidationError):
            TicketSummaryResponse.model_validate({**payload, field: value})
    detail = example(response_contract, "TicketDetail")
    for field in ("report_photos", "resolution_photos", "assignments", "timeline"):
        with pytest.raises(ValidationError):
            TicketDetailResponse.model_validate({**detail, field: None})
