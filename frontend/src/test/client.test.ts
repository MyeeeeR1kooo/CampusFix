/**
 * The fetch wrapper against the declared envelope (#48).
 *
 * These are the cases the scaffold's whole "one place parses errors" claim rests on, so
 * each one is a shape the contract actually allows rather than a convenience: a bare
 * success body, a 204 with nothing to read, a four-field error, an empty `field_errors`,
 * and a body that is not JSON at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, buildQuery, http, setUnauthorizedHandler } from "../api/client";
import { jsonResponse, userPayload, validationError } from "../test-helpers";


/** The rejection, typed: `catch((e) => e)` hands back `unknown` and every assertion below
 *  then needs a cast, which is how a test stops checking the thing it means to check. */
async function rejectionOf(build: () => Promise<unknown>): Promise<ApiError> {
  return build().then(
    () => {
      throw new Error("expected the request to fail");
    },
    (error) => error as ApiError,
  );
}


beforeEach(() => {
  setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
});

describe("success bodies", () => {
  it("returns the declared object, unwrapped", async () => {
    // The draft contract changed this: `POST /api/auth/login` answers a bare User.
    // The previous scaffold read `{ user }`, which resolved to undefined against it.
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(userPayload(), 200)));
    await expect(http.get("/api/me")).resolves.toMatchObject({ email: "reporter01@campusfix.test" });
  });

  it("reads nothing for a 204", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, headers: new Headers() }));
    vi.stubGlobal("fetch", fetchMock);
    // `.json()` on a 204 would throw; the rule is that we never ask it to.
    await expect(http.post("/api/auth/logout")).resolves.toBeUndefined();
  });
});

describe("error envelope", () => {
  it("carries code, request id and field errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => validationError({ title: "必填字段缺失" })));
    const error = await rejectionOf(() => http.post("/api/tickets"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(422);
    expect(error.requestId).toBe("test-request-id");
    expect(error.fields).toEqual({ title: "必填字段缺失" });
  });

  it("treats an empty field_errors as no field errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "CONFLICT", message: "Not allowed in this state.", request_id: "req_1", field_errors: [] } },
          409,
        ),
      ),
    );
    const error = await rejectionOf(() => http.get("/api/tickets"));
    expect(error.isConflict).toBe(true);
    expect(error.fieldErrors).toEqual([]);
  });

  it("falls back to the X-Request-ID header when the body has no id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "NOT_FOUND", message: "Gone." } }, 404)));
    const error = await rejectionOf(() => http.get("/api/me"));
    expect(error.code).toBe("NOT_FOUND");
    expect(error.requestId).toBe("test-request-id");
  });

  it("still types a non-JSON failure instead of throwing a parse error", async () => {
    const html = vi.fn(async () => ({
      ok: false,
      status: 502,
      headers: new Headers(),
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    vi.stubGlobal("fetch", html);
    const error = await rejectionOf(() => http.get("/api/me"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.status).toBe(502);
    expect(error.fieldErrors).toEqual([]);
  });

  it("types an envelope-shaped body with a missing message as a failure too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: { code: "FORBIDDEN" } }, 403)));
    const error = await rejectionOf(() => http.get("/api/me"));
    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.status).toBe(403);
  });
});

describe("401 handling (§13.3)", () => {
  it("notifies the session owner and still throws", async () => {
    const cleared = vi.fn();
    setUnauthorizedHandler(cleared);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "UNAUTHORIZED", message: "No.", request_id: "r", field_errors: [] } }, 401),
      ),
    );

    await expect(http.get("/api/me")).rejects.toBeInstanceOf(ApiError);
    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it("does not notify on other failures", async () => {
    const cleared = vi.fn();
    setUnauthorizedHandler(cleared);
    vi.stubGlobal("fetch", vi.fn(async () => validationError({ title: "bad" })));
    await http.post("/api/tickets").catch(() => undefined);
    expect(cleared).not.toHaveBeenCalled();
  });
});

describe("buildQuery", () => {
  it("keeps cursor and limit and drops absent filters", () => {
    expect(buildQuery({ cursor: "abc", limit: 20, status: undefined, q: "" })).toBe("?cursor=abc&limit=20");
  });

  it("emits no marker for a first page", () => {
    expect(buildQuery({ cursor: null, limit: undefined })).toBe("");
  });

  it("keeps a false filter, because false is a value", () => {
    expect(buildQuery({ active: false })).toBe("?active=false");
  });
});
