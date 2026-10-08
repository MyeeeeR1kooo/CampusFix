/**
 * Mock mount point tests (#48).
 *
 * These assert the seam, not any fixture: what happens when the switch is off,
 * when nothing is installed, and when a responder declines a request. The Mock
 * layer itself is 舒玺悦's; if these stay green their side can be swapped freely.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, http } from "../api/client";
import { installMock, requestViaMock } from "../api/mockBridge";
import { jsonResponse, stubApi, validationError } from "../test-helpers";

describe("the Mock mount point", () => {
  afterEach(() => {
    installMock(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stays out of the way when nothing is installed", async () => {
    const api = stubApi([{ match: /\/api\/tickets\/7$/, reply: () => ({ body: { id: 7 } }) }]);
    await expect(http.get("/api/tickets/7")).resolves.toEqual({ id: 7 });
    expect(api.calls).toHaveLength(1);
  });

  it("serves a mocked response without reaching the network", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    const api = stubApi([{ match: /\/api\/tickets\/7$/, reply: () => ({ body: { id: -1 } }) }]);
    installMock(() => jsonResponse({ id: 7, code: "CF-20261002-000007" }));

    await expect(http.get("/api/tickets/7")).resolves.toEqual({ id: 7, code: "CF-20261002-000007" });
    // The stub still answers, so a fall-through would look like a passing test
    // with the wrong body. Assert the transport was never consulted.
    expect(api.calls).toHaveLength(0);
  });

  it("hands a declined request to the real backend address", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    const api = stubApi([{ match: /\/api\/tickets\/8$/, reply: () => ({ body: { id: 8 } }) }]);
    installMock((request) => (request.path.includes("/7") ? jsonResponse({ id: 7 }) : null));

    await expect(http.get("/api/tickets/8")).resolves.toEqual({ id: 8 });
    expect(api.calls.map((c) => c.url)).toEqual(["/api/tickets/8"]);
  });

  it("does not intercept when the switch is off", async () => {
    vi.stubEnv("VITE_USE_MOCK", "0");
    const api = stubApi([{ match: /\/api\/tickets\/9$/, reply: () => ({ body: { id: 9 } }) }]);
    const responder = vi.fn(() => jsonResponse({ id: 999 }));
    installMock(responder);

    await expect(http.get("/api/tickets/9")).resolves.toEqual({ id: 9 });
    expect(responder).not.toHaveBeenCalled();
    expect(api.calls).toHaveLength(1);
  });

  it("runs the shared envelope handling over a mocked failure", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    // `validationError` already builds the Response; wrapping it again would hand the
    // client a body that is not the envelope, and the test would pass for the wrong reason.
    installMock(() => validationError({ room_or_area: "Required" }));

    const thrown: unknown = await http.post("/api/tickets", {}).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(422);
    expect(error.fields).toEqual({ room_or_area: "Required" });
  });

  it("detaches again when the responder is removed", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    installMock(() => jsonResponse({ id: 7 }));
    await requestViaMock({ method: "GET", path: "/api/tickets/7" });
    installMock(null);

    await expect(requestViaMock({ method: "GET", path: "/api/tickets/7" })).resolves.toBeNull();
  });

  it("passes the method, path and body a fixture needs to match on", async () => {
    vi.stubEnv("VITE_USE_MOCK", "1");
    const seen: string[] = [];
    installMock((request) => {
      seen.push(`${request.method} ${request.path} ${JSON.stringify(request.json)}`);
      return jsonResponse({ ok: true });
    });

    await http.post("/api/tickets?x=1", { title: "heating" });
    expect(seen).toEqual(['POST /api/tickets?x=1 {"title":"heating"}']);
  });
});
