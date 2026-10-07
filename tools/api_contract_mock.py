"""Export and serve validated, stateless fixtures from the OpenAPI contract.

This is a frontend preview aid, not a backend simulator: request bodies, Origin,
session cookies, permissions, state transitions and query filters are NOT checked.
Restart the server after editing the contract. Use a same-origin development
proxy instead of treating this loopback-only server as a production API.
"""

import argparse
import base64
import hashlib
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

import yaml
from jsonschema import Draft202012Validator, FormatChecker


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTRACT = REPOSITORY_ROOT / "docs" / "api" / "openapi.yaml"
ARTIFACT_DIRECTORY = REPOSITORY_ROOT / ".contract-artifacts"
HTTP_METHODS = {"get", "post", "put", "patch", "delete", "options", "head", "trace"}
MOCK_NOTICE = (
    "Stateless contract fixtures only. No request validation, authentication, "
    "authorization, Origin checks, filtering, persistence or workflow simulation."
)
# A public, non-sensitive 1 x 1 PNG fixture; not an actual ticket attachment.
PNG_FIXTURE = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42Y"
    "AAAAASUVORK5CYII="
)


class ContractMockError(ValueError):
    """An actionable contract or mock-control error."""


def local_reference(document: Dict[str, Any], reference: str) -> Any:
    """Resolve local JSON pointers without reading remote resources."""
    if not reference.startswith("#/"):
        raise ContractMockError("Only local #/... references are supported: " + reference)
    value = document
    try:
        for part in reference[2:].split("/"):
            value = value[part.replace("~1", "/").replace("~0", "~")]
    except (KeyError, TypeError) as exc:
        raise ContractMockError("Missing contract reference: " + reference) from exc
    return value


def dereference(document: Dict[str, Any], value: Any) -> Any:
    """Resolve a reference object, retaining OpenAPI 3.1 sibling annotations."""
    seen = set()
    while isinstance(value, dict) and "$ref" in value:
        reference = value["$ref"]
        if reference in seen:
            raise ContractMockError("Cyclic contract reference: " + reference)
        seen.add(reference)
        target = local_reference(document, reference)
        if not isinstance(target, dict):
            raise ContractMockError("Reference must resolve to an object: " + reference)
        value = dict(target, **{key: item for key, item in value.items() if key != "$ref"})
    return value


def expand_schema(document: Dict[str, Any], schema: Any, trail: Tuple[str, ...] = ()) -> Any:
    """Expand this acyclic contract's schemas for JSON Schema validation."""
    if isinstance(schema, list):
        return [expand_schema(document, item, trail) for item in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        reference = schema["$ref"]
        if reference in trail:
            raise ContractMockError("Recursive schema needs a resolver: " + reference)
        target = expand_schema(document, local_reference(document, reference), trail + (reference,))
        siblings = {
            key: expand_schema(document, value, trail)
            for key, value in schema.items()
            if key != "$ref"
        }
        # Both the referenced schema and its siblings apply in JSON Schema 2020-12.
        return {"allOf": [target, siblings]} if siblings else target
    return {key: expand_schema(document, value, trail) for key, value in schema.items()}


def media_examples(document: Dict[str, Any], media: Dict[str, Any]) -> List[Tuple[str, Any]]:
    """Read examples from the authoritative media object, never synthesize JSON."""
    if "examples" in media:
        result = []
        for name, example_object in media["examples"].items():
            example = dereference(document, example_object)
            if "value" not in example:
                raise ContractMockError(
                    "Example '" + name + "' needs an inline value; externalValue is not fetched."
                )
            result.append((name, example["value"]))
        return result
    if "example" in media:
        return [("default", media["example"])]
    return []


def response_headers(document: Dict[str, Any], response: Dict[str, Any]) -> Dict[str, str]:
    """Copy harmless explicit header examples; never issue a fake session cookie."""
    result = {}
    for name, header_object in response.get("headers", {}).items():
        if name.lower() in {"set-cookie", "content-type", "content-length"}:
            continue
        header = dereference(document, header_object)
        schema = dereference(document, header.get("schema", {}))
        example = header.get("example", schema.get("example"))
        if isinstance(example, (str, int, float)) and "\r" not in str(example) and "\n" not in str(example):
            result[name] = str(example)
    return result


def build_manifest(document: Dict[str, Any], contract_path: Path) -> Dict[str, Any]:
    """Validate every exported JSON fixture against its actual response schema."""
    if not isinstance(document, dict) or not isinstance(document.get("paths"), dict):
        raise ContractMockError("The YAML must contain an OpenAPI object with a paths mapping.")
    records = []
    operation_ids = set()
    for path, path_object in document.get("paths", {}).items():
        path_object = dereference(document, path_object)
        for method, operation in path_object.items():
            if method not in HTTP_METHODS:
                continue
            operation = dereference(document, operation)
            operation_id = operation.get("operationId")
            if not operation_id or operation_id in operation_ids:
                raise ContractMockError("Missing or duplicate operationId at " + method.upper() + " " + path)
            operation_ids.add(operation_id)
            has_success = False
            for status_text, response_object in operation.get("responses", {}).items():
                status_text = str(status_text)
                if not re.fullmatch(r"[1-5][0-9]{2}", status_text):
                    raise ContractMockError(operation_id + " needs an explicit HTTP status, not " + status_text)
                status = int(status_text)
                has_success = has_success or 200 <= status < 300
                response = dereference(document, response_object)
                headers = response_headers(document, response)
                common = {
                    "path": path,
                    "method": method.upper(),
                    "operationId": operation_id,
                    "status": status,
                    "headers": headers,
                }
                content = response.get("content", {})
                if status in {204, 304}:
                    if content:
                        raise ContractMockError(operation_id + " " + status_text + " must not define a response body.")
                    records.append(dict(common, contentType=None, exampleName="empty", bodyKind="empty", body=None))
                    continue
                if not content:
                    raise ContractMockError(operation_id + " " + status_text + " needs response content or an explicit 204.")
                for content_type, media_object in content.items():
                    media = dereference(document, media_object)
                    schema = expand_schema(document, media.get("schema", {}))
                    if schema.get("format") == "binary" or content_type.startswith("image/"):
                        records.append(
                            dict(common, contentType=content_type, exampleName="binary", bodyKind="binary", body=None)
                        )
                        continue
                    if content_type != "application/json" and not content_type.endswith("+json"):
                        raise ContractMockError("Unsupported fixture media type: " + content_type)
                    examples = media_examples(document, media)
                    if not examples:
                        raise ContractMockError(
                            operation_id + " " + status_text + " " + content_type
                            + " needs an example/examples value in docs/api/openapi.yaml."
                        )
                    Draft202012Validator.check_schema(schema)
                    validator = Draft202012Validator(schema, format_checker=FormatChecker())
                    for example_name, body in examples:
                        failures = list(validator.iter_errors(body))
                        if failures:
                            failure = failures[0]
                            location = "/" + "/".join(str(item) for item in failure.absolute_path)
                            raise ContractMockError(
                                operation_id + " " + status_text + " example '" + example_name
                                + "' violates its schema at " + location + ": " + failure.message
                            )
                        # Reject accidental non-JSON YAML values (dates must be quoted).
                        try:
                            json.dumps(body, allow_nan=False)
                        except (TypeError, ValueError) as exc:
                            raise ContractMockError(operation_id + " example is not JSON-compatible: " + str(exc)) from exc
                        records.append(
                            dict(common, contentType=content_type, exampleName=example_name, bodyKind="json", body=body)
                        )
            if not has_success:
                raise ContractMockError(operation_id + " has no documented success response.")
    if not records:
        raise ContractMockError("The contract has no operations to export.")
    try:
        source_label = contract_path.resolve().relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        source_label = contract_path.name
    return {
        "format": "campusfix-stateless-contract-mock-v1",
        "contract": {
            "path": source_label,
            "version": document.get("info", {}).get("version"),
            "sha256": hashlib.sha256(contract_path.read_bytes()).hexdigest(),
        },
        "notice": MOCK_NOTICE,
        "operationCount": len(operation_ids),
        "responseCount": len(records),
        "responses": records,
    }


def path_expression(path: str) -> re.Pattern:
    """Match path placeholders without changing the stored example's IDs."""
    parts = re.split(r"(\{[^/{}]+\})", path)
    return re.compile("^" + "".join("[^/]+" if part.startswith("{") else re.escape(part) for part in parts) + "$")


def make_handler(manifest: Dict[str, Any]):
    """Return a request handler bound to one validated contract snapshot."""
    grouped = {}
    for record in manifest["responses"]:
        grouped.setdefault((record["method"], record["path"]), []).append(record)
    routes = [
        (method, path_expression(path), records)
        for (method, path), records in sorted(grouped.items(), key=lambda item: ("{" in item[0][1], item[0][1]))
    ]

    class ContractMockHandler(BaseHTTPRequestHandler):
        server_version = "CampusFixContractMock/1"

        def control_error(self, status: int, message: str) -> None:
            # Transport/control errors are visibly separate from contract API errors.
            self.write_response(status, "application/json", {"mock_error": message}, {"X-Mock-Control-Error": "true"})

        def write_response(self, status: int, content_type: Optional[str], body: Any, headers: Dict[str, str]) -> None:
            if content_type is None:
                encoded = b""
            elif isinstance(body, bytes):
                encoded = body
            else:
                encoded = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            if content_type is not None:
                self.send_header("Content-Type", content_type)
            response_header_values = dict(headers)
            if not any(name.lower() == "cache-control" for name in response_header_values):
                response_header_values["Cache-Control"] = "no-store"
            for name, value in response_header_values.items():
                self.send_header(name, value)
            self.send_header("X-Mock-Response", "stateless-contract-fixture")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(encoded)

        def serve_fixture(self) -> None:
            requested_path = urlsplit(self.path).path
            records = None
            for method, expression, candidates in routes:
                if method == self.command and expression.fullmatch(requested_path):
                    records = candidates
                    break
            if records is None:
                self.control_error(404, "No documented operation for " + self.command + " " + requested_path)
                return
            status_header = self.headers.get("X-Mock-Status")
            if status_header is not None:
                if not re.fullmatch(r"[1-5][0-9]{2}", status_header):
                    self.control_error(400, "X-Mock-Status must be a documented three-digit HTTP status.")
                    return
                desired_status = int(status_header)
            else:
                desired_status = min(record["status"] for record in records if 200 <= record["status"] < 300)
            candidates = [record for record in records if record["status"] == desired_status]
            example_header = self.headers.get("X-Mock-Example")
            if example_header is not None:
                candidates = [record for record in candidates if record["exampleName"] == example_header]
            if not candidates:
                options = ", ".join(str(record["status"]) + ":" + record["exampleName"] for record in records)
                self.control_error(400, "Unknown mock status/example. Available: " + options)
                return
            record = next((item for item in candidates if item["contentType"] == "image/png"), candidates[0])
            headers = dict(record["headers"])
            if record["bodyKind"] == "binary":
                if record["contentType"] != "image/png":
                    self.control_error(501, "This binary media type is metadata-only; the preview serves only a tiny PNG fixture.")
                    return
                headers["Content-Disposition"] = 'inline; filename="mock-fixture.png"'
                body = PNG_FIXTURE
            else:
                body = record["body"]
                if isinstance(body, dict) and isinstance(body.get("error"), dict):
                    headers["X-Request-ID"] = body["error"].get("request_id", "req_mock")
            self.write_response(record["status"], record["contentType"], body, headers)

        do_GET = serve_fixture
        do_POST = serve_fixture
        do_PATCH = serve_fixture
        do_PUT = serve_fixture
        do_DELETE = serve_fixture
        do_OPTIONS = serve_fixture
        do_HEAD = serve_fixture

    return ContractMockHandler


def export_manifest(manifest: Dict[str, Any], destination: Path) -> None:
    """Keep generated fixtures within the repository's ignored artifact directory."""
    destination = destination.resolve()
    try:
        destination.relative_to(ARTIFACT_DIRECTORY.resolve())
    except ValueError as exc:
        raise ContractMockError("Export path must be inside ignored .contract-artifacts/.") from exc
    if destination.suffix.lower() != ".json":
        raise ContractMockError("Export path must end in .json.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", type=Path, default=DEFAULT_CONTRACT, help="OpenAPI contract (default: docs/api/openapi.yaml)")
    parser.add_argument("--export", type=Path, default=ARTIFACT_DIRECTORY / "mock-responses.json", help="JSON export within ignored .contract-artifacts/")
    parser.add_argument("--serve", action="store_true", help="After export, serve stateless fixtures on loopback only")
    parser.add_argument("--port", type=int, default=4010, help="Loopback preview port (default: 4010)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be in the range 1..65535")
    try:
        with args.contract.open(encoding="utf-8") as source:
            document = yaml.safe_load(source)
        manifest = build_manifest(document, args.contract)
        export_manifest(manifest, args.export)
        print("Validated {operationCount} operations / {responseCount} response fixtures.".format(**manifest))
        print("Exported: " + str(args.export.resolve()))
        if args.serve:
            server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(manifest))
            print("Preview: http://127.0.0.1:" + str(args.port), flush=True)
            print(MOCK_NOTICE, flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                print("Preview stopped.")
            finally:
                server.server_close()
        return 0
    except (ContractMockError, OSError, yaml.YAMLError) as exc:
        print("Contract mock failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
