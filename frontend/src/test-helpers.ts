/**
 * Test helpers — a tiny fetch stub instead of a mocking library.
 *
 * Stubbing at the `fetch` boundary keeps the tests honest: they exercise the real client,
 * the real envelope parsing and the real rendering. The shapes here follow
 * `docs/api/openapi.yaml` — success bodies are the declared object with no extra wrapper
 * (the request id travels in the `X-Request-ID` header), and every error is the four-field
 * envelope.
 */

import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200, requestId = "test-request-id"): Response {
  const headers = new Headers({ "X-Request-ID": requestId });
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers,
  } as unknown as Response;
}

export interface StubRoute {
  /** Matched against the request URL. */
  match: RegExp;
  /** Optional method constraint; defaults to any method. */
  method?: string;
  reply: () => { status?: number; body: unknown };
}

export interface StubCall {
  url: string;
  method: string;
  body: unknown;
}

/** Installs a global fetch stub and records every call for assertions. */
export function stubApi(routes: StubRoute[]): { calls: StubCall[] } {
  const calls: StubCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method, body: init?.body });

    for (const route of routes) {
      if (!route.match.test(url)) continue;
      if (route.method && route.method !== method) continue;
      const { status = 200, body } = route.reply();
      return jsonResponse(body, status);
    }

    return errorResponse("NOT_FOUND", 404, `No stub matched ${method} ${url}`);
  });

  vi.stubGlobal("fetch", mock);
  return { calls };
}

/** The declared error envelope; `field_errors` is required even when empty. */
export function errorResponse(
  code: string,
  status = 400,
  message = "The request could not be completed.",
  fieldErrors: Array<{ field: string; message: string; type: string }> = [],
): Response {
  return jsonResponse({ error: { code, message, request_id: "test-request-id", field_errors: fieldErrors } }, status);
}

/** A single-field VALIDATION_ERROR, the way §11.1 says the server emits it. */
export function validationError(fields: Record<string, string>): Response {
  return errorResponse(
    "VALIDATION_ERROR",
    422,
    "Input validation failed.",
    Object.entries(fields).map(([field, message]) => ({ field, message, type: "value_error" })),
  );
}

/** A minimal `User` as the contract declares it — returned bare, not wrapped. */
export function userPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "测试用户",
    email: "reporter01@campusfix.test",
    role: "REPORTER",
    active: true,
    created_at: "2026-10-02T00:00:00Z",
    updated_at: "2026-10-02T00:00:00Z",
    ...overrides,
  };
}
