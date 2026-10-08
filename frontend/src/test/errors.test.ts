/**
 * Classification of the contract's eight error codes (§11.1, §13.3).
 *
 * The scaffold used to recognise `VERSION_CONFLICT` and `INVALID_STATE_TRANSITION`, which
 * the contract never emits — so the 409 affordance could not fire in production, and the
 * old tests passed anyway because they invented the same codes. These tests take their
 * codes from the generated schema, so a rename in #46 fails here instead of hiding.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "../api/client";
import { classify, conflictMessage, fieldErrors, referenceLine } from "../lib/errors";
import schema from "../api/generated/schema.d.ts?raw";

/** The eight members, read from the generated ErrorCode rather than retyped here. */
const CODES = [
  ...((schema.match(/^\s{8}ErrorCode: (.*);$/m)?.[1].match(/"[A-Z_]+"/g) ?? []) as string[]),
].map((quoted) => quoted.replace(/"/g, ""));

function apiError(status: number, code: string, message = "Server text.", requestId?: string) {
  return new ApiError({ status, code: code as never, message, requestId, fieldErrors: [] });
}

describe("the census itself", () => {
  it("finds all eight contract codes", () => {
    // A regex that matches nothing is indistinguishable from a clean tree, so the
    // extraction has to be checked before its results mean anything.
    expect(CODES).toHaveLength(8);
    expect(CODES).toContain("TICKET_VERSION_CONFLICT");
    expect(CODES).toContain("ORIGIN_NOT_ALLOWED");
  });
});

describe("classify", () => {
  it("maps a transport failure to a local network label", () => {
    const classified = classify(new TypeError("fetch failed"));
    expect(classified.kind).toBe("system");
    expect(classified.code).toBe("NETWORK_ERROR");
  });

  it("keeps the server's message for a class the UI can show directly", () => {
    expect(classify(apiError(404, "NOT_FOUND", "No such ticket.")).message).toBe("No such ticket.");
  });

  it("substitutes copy when the system class arrives with no message", () => {
    expect(classify(apiError(500, "INTERNAL_ERROR", "")).message).toMatch(/temporarily unavailable/);
  });

  const expectations: Record<string, string> = {
    VALIDATION_ERROR: "validation",
    UNAUTHORIZED: "permission",
    FORBIDDEN: "permission",
    NOT_FOUND: "notfound",
    CONFLICT: "conflict",
    TICKET_VERSION_CONFLICT: "conflict",
    ORIGIN_NOT_ALLOWED: "permission",
    INTERNAL_ERROR: "system",
  };

  // The status the contract pairs with each code; §11.1 says VALIDATION_ERROR spans
  // 400/413/415/422, so the classification must not depend on the number alone.
  const STATUSES: Record<string, number> = {
    VALIDATION_ERROR: 422,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    TICKET_VERSION_CONFLICT: 409,
    ORIGIN_NOT_ALLOWED: 403,
    INTERNAL_ERROR: 500,
  };

  it.each(Object.entries(expectations))("%s → %s", (code, kind) => {
    expect(classify(apiError(STATUSES[code], code)).kind).toBe(kind);
  });

  it("classifies every code the contract declares, and no others", () => {
    // Both directions: a code #46 adds must get a presentation decision, and a code it
    // drops must not keep a stale branch in the UI.
    expect(Object.keys(expectations).sort()).toEqual([...CODES].sort());
  });
});

describe("field errors", () => {
  it("reads the dotted field paths the server sends", () => {
    const error = new ApiError({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Input validation failed.",
      requestId: "req_1",
      fieldErrors: [
        { field: "title", message: "必填字段缺失", type: "missing" },
        { field: "location_id", message: "地点不存在", type: "not_found" },
      ],
    });
    expect(fieldErrors(error)).toEqual({ title: "必填字段缺失", location_id: "地点不存在" });
  });

  it("is empty for a non-validation failure", () => {
    expect(fieldErrors(apiError(403, "FORBIDDEN"))).toEqual({});
  });
});

describe("§13.3 conflict copy", () => {
  it("says the ticket was updated for a stale version", () => {
    expect(conflictMessage(classify(apiError(409, "TICKET_VERSION_CONFLICT")))).toMatch(/someone else/);
  });

  it("says the ticket moved for a state conflict", () => {
    expect(conflictMessage(classify(apiError(409, "CONFLICT")))).toMatch(/moved on/);
  });

  it("shares one presentation between both 409 codes", () => {
    expect(classify(apiError(409, "CONFLICT")).kind).toBe(classify(apiError(409, "TICKET_VERSION_CONFLICT")).kind);
  });
});

describe("request reference", () => {
  it("shows the id support needs", () => {
    expect(referenceLine(classify(apiError(500, "INTERNAL_ERROR", "boom", "req_abc")))).toBe("Reference: req_abc");
  });

  it("shows nothing when there is no id to trace", () => {
    expect(referenceLine(classify(new Error("nope")))).toBeNull();
  });
});
