"""Contract mock checks: run with `python -m unittest discover -s tools`."""

import copy
import json
import struct
import tempfile
import threading
import unittest
import zlib
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import yaml

from api_contract_mock import (
    ARTIFACT_DIRECTORY,
    DEFAULT_CONTRACT,
    PNG_FIXTURE,
    ContractMockError,
    build_manifest,
    export_manifest,
    make_handler,
)


class ContractMockTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = yaml.safe_load(DEFAULT_CONTRACT.read_text(encoding="utf-8"))
        cls.manifest = build_manifest(cls.document, DEFAULT_CONTRACT)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.manifest))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = "http://127.0.0.1:" + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, method, path, headers=None):
        request = Request(self.base_url + path, method=method, headers=headers or {})
        # No body/auth cookie is intentional: this server is a stateless fixture aid.
        try:
            response = urlopen(request, timeout=5)
        except HTTPError as exc:
            response = exc
        with response:
            return response.status, response.headers, response.read()

    def test_every_operation_has_a_success_fixture(self):
        records = self.manifest["responses"]
        operation_ids = {record["operationId"] for record in records}
        successes = {record["operationId"] for record in records if 200 <= record["status"] < 300}
        self.assertEqual(operation_ids, successes)
        self.assertEqual(self.manifest["operationCount"], len(operation_ids))
        self.assertEqual(self.manifest["responseCount"], len(records))

    def test_invalid_contract_example_fails_before_export_or_serve(self):
        document = copy.deepcopy(self.document)
        document["paths"]["/health"]["get"]["responses"]["200"]["content"]["application/json"]["example"] = {"status": "broken"}
        with self.assertRaisesRegex(ContractMockError, "getHealth.*violates its schema"):
            build_manifest(document, DEFAULT_CONTRACT)

    def test_missing_success_example_is_actionable(self):
        document = copy.deepcopy(self.document)
        del document["paths"]["/health"]["get"]["responses"]["200"]["content"]["application/json"]["example"]
        with self.assertRaisesRegex(ContractMockError, "getHealth.*needs an example"):
            build_manifest(document, DEFAULT_CONTRACT)

    def test_export_is_deterministic_and_stays_in_ignored_directory(self):
        ARTIFACT_DIRECTORY.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ARTIFACT_DIRECTORY) as directory:
            first = Path(directory) / "first.json"
            second = Path(directory) / "second.json"
            export_manifest(self.manifest, first)
            export_manifest(self.manifest, second)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(json.loads(first.read_text(encoding="utf-8")), self.manifest)
        with self.assertRaisesRegex(ContractMockError, "inside ignored"):
            export_manifest(self.manifest, DEFAULT_CONTRACT.parent / "must-not-write.json")

    def test_health_and_json_list_detail_respond_without_real_auth(self):
        status, headers, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"status": "ok"})
        self.assertEqual(headers["X-Mock-Response"], "stateless-contract-fixture")
        status, _, body = self.request("GET", "/api/tickets?status=CLOSED", {"X-Mock-Example": "empty"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"items": [], "next_cursor": None})
        status, _, body = self.request("GET", "/api/tickets/999")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["id"], 1, "Path IDs do not mutate the authoritative fixture.")

    def test_success_variant_is_selected_by_name_not_inferred_from_request(self):
        status, _, body = self.request("POST", "/api/tickets/1/review", {"X-Mock-Example": "rejected"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "REJECTED")

    def test_error_variants_and_request_id_match_documented_examples(self):
        for name, code in [("version", "TICKET_VERSION_CONFLICT"), ("state", "CONFLICT")]:
            with self.subTest(example=name):
                status, headers, body = self.request(
                    "POST", "/api/tickets/1/start", {"X-Mock-Status": "409", "X-Mock-Example": name}
                )
                error = json.loads(body)["error"]
                self.assertEqual(status, 409)
                self.assertEqual(error["code"], code)
                self.assertEqual(headers["X-Request-ID"], error["request_id"])

    def test_ticket_list_403_manifest_has_only_role_fixture(self):
        records = [
            record for record in self.manifest["responses"]
            if record["operationId"] == "listTickets" and record["status"] == 403
        ]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["method"], "GET")
        self.assertEqual(records[0]["path"], "/api/tickets")
        self.assertEqual(records[0]["exampleName"], "role")
        self.assertEqual(records[0]["body"]["error"]["code"], "FORBIDDEN")

    def test_ticket_list_role_error_is_explicitly_selectable(self):
        # Selecting a documented fixture does not verify real role authorization.
        status, headers, body = self.request(
            "GET", "/api/tickets?current_assignee_id=3",
            {"X-Mock-Status": "403", "X-Mock-Example": "role"},
        )
        error = json.loads(body)["error"]
        self.assertEqual(status, 403)
        self.assertEqual(error["code"], "FORBIDDEN")
        self.assertEqual(error["field_errors"], [])
        self.assertEqual(headers["X-Request-ID"], error["request_id"])
        self.assertEqual(headers["X-Mock-Response"], "stateless-contract-fixture")
        self.assertIsNone(headers.get("X-Mock-Control-Error"))

    def test_ticket_list_origin_fixture_is_a_mock_control_error(self):
        status, headers, body = self.request(
            "GET", "/api/tickets",
            {"X-Mock-Status": "403", "X-Mock-Example": "origin"},
        )
        self.assertEqual(status, 400)
        self.assertEqual(headers["X-Mock-Control-Error"], "true")
        payload = json.loads(body)
        self.assertIn("mock_error", payload)
        self.assertNotIn("error", payload)

    def test_assignment_target_errors_are_selectable_422_field_errors(self):
        for name in ("technician_not_found", "technician_wrong_role", "technician_inactive"):
            with self.subTest(example=name):
                status, headers, body = self.request(
                    "POST", "/api/tickets/1/assign", {"X-Mock-Status": "422", "X-Mock-Example": name}
                )
                error = json.loads(body)["error"]
                self.assertEqual(status, 422)
                self.assertEqual(error["code"], "VALIDATION_ERROR")
                self.assertEqual([field["field"] for field in error["field_errors"]], ["technician_id"])
                self.assertEqual(headers["X-Request-ID"], error["request_id"])

    def test_logout_has_no_body_and_does_not_issue_a_fake_session_cookie(self):
        status, headers, body = self.request("POST", "/api/auth/logout")
        self.assertEqual(status, 204)
        self.assertEqual(body, b"")
        self.assertIsNone(headers.get("Content-Type"))
        self.assertIsNone(headers.get("Set-Cookie"))
        status, headers, _ = self.request("POST", "/api/auth/login")
        self.assertEqual(status, 200)
        self.assertIsNone(headers.get("Set-Cookie"))

    def test_binary_download_is_png_bytes_not_json(self):
        status, headers, body = self.request("GET", "/api/attachments/1")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(body, PNG_FIXTURE)
        self.assertTrue(body.startswith(b"\x89PNG\r\n\x1a\n"))
        # Validate all chunk CRCs so the tiny preview fixture is actually decodable.
        position = 8
        while position < len(body):
            length = struct.unpack(">I", body[position:position + 4])[0]
            chunk = body[position + 4:position + 8 + length]
            crc = struct.unpack(">I", body[position + 8 + length:position + 12 + length])[0]
            self.assertEqual(zlib.crc32(chunk) & 0xFFFFFFFF, crc)
            position += length + 12
        self.assertEqual(position, len(body))

    def test_mock_control_errors_are_not_presented_as_backend_errors(self):
        for path, headers in [
            ("/api/tickets", {"X-Mock-Status": "not-a-status"}),
            ("/api/tickets", {"X-Mock-Example": "missing-example"}),
            ("/not-an-api", {}),
        ]:
            with self.subTest(path=path, headers=headers):
                status, response_headers, body = self.request("GET", path, headers)
                self.assertIn(status, (400, 404))
                self.assertEqual(response_headers["X-Mock-Control-Error"], "true")
                self.assertIn("mock_error", json.loads(body))
                self.assertNotIn("error", json.loads(body))


if __name__ == "__main__":
    unittest.main()
