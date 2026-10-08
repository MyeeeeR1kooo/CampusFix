/**
 * The endpoint map, censused against the contract rather than against a hand-typed list.
 *
 * #48 asks for a request wrapper whose paths and paging come from the contract, so this
 * file reads the *generated* schema and derives both directions of the check:
 *
 *   • every function `endpoints.ts` exports must be a declared operation, and every
 *     declared business operation must have a function — so an invented path like the old
 *     `/tickets/{id}/edit` fails, and so does a contract operation nobody wired;
 *   • every URL a function produces must match a template in `paths`.
 *
 * Reading the generated artifact is deliberate. `schema.d.ts` is types only, so the census
 * parses its text — that keeps the expectation tied to the contract instead of to whatever
 * someone last remembered to type into a test.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../api/endpoints";
import { jsonResponse, userPayload } from "../test-helpers";

// Read as text through Vite (`?raw`), not with node:fs: the suite runs in jsdom, where
// `import.meta.url` is not a file URL. The census needs the generated file's contents,
// not its types, and this is the one way to get it without assuming a working directory.
import schema from "../api/generated/schema.d.ts?raw";

function declaredPaths(): string[] {
  const block = schema.slice(
    schema.indexOf("export interface paths {"),
    schema.indexOf("export type webhooks"),
  );
  return [...block.matchAll(/^    "(\/[^"]+)": \{/gm)].map((m) => m[1]);
}

function declaredOperations(): string[] {
  const block = schema.slice(schema.indexOf("export interface operations {"));
  return [...block.matchAll(/^    (\w+): \{$/gm)].map((m) => m[1]);
}

function templateToRegExp(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\\\{[^}]+\\\}/g, "[^/?]+")}(\\?.*)?$`);
}

const PATHS = declaredPaths();
const BUSINESS_OPERATIONS = declaredOperations().filter((name) => name !== "getHealth");

afterEach(() => vi.unstubAllGlobals());

function recordedUrl(build: () => Promise<unknown>): Promise<string> {
  let url = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      url = String(input);
      return jsonResponse(userPayload(), 200);
    }),
  );
  return build().then(
    () => url,
    () => url,
  );
}

describe("operation coverage", () => {
  it("exports exactly one function per declared business operation", () => {
    expect(Object.keys(api).sort()).toEqual([...BUSINESS_OPERATIONS].sort());
  });

  it("refuses to census an empty contract", () => {
    // A regex that matches nothing looks identical to a clean tree, so the census itself
    // has to fail loudly if the generated file ever changes shape.
    expect(PATHS.length).toBeGreaterThan(10);
    expect(BUSINESS_OPERATIONS.length).toBeGreaterThan(15);
  });
});

describe("generated URLs", () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ["login", () => api.login({ email: "a@b.c", password: "x" }), "/api/auth/login"],
    ["logout", () => api.logout(), "/api/auth/logout"],
    ["getCurrentUser", () => api.getCurrentUser(), "/api/me"],
    ["listTickets", () => api.listTickets(), "/api/tickets"],
    ["createTicket", () => api.createTicket({ title: "t", description: "d", category: "HVAC", location_id: 1 }), "/api/tickets"],
    ["getTicket", () => api.getTicket(42), "/api/tickets/42"],
    ["reviewTicket", () => api.reviewTicket(42, { decision: "APPROVE", category: "HVAC", priority: "LOW", expected_version: 1 }), "/api/tickets/42/review"],
    ["assignTicket", () => api.assignTicket(42, { technician_id: 7, expected_version: 1 }), "/api/tickets/42/assign"],
    ["startTicket", () => api.startTicket(42, { expected_version: 1 }), "/api/tickets/42/start"],
    ["resolveTicket", () => api.resolveTicket(42, { resolution_note: "done", expected_version: 1 }), "/api/tickets/42/resolve"],
    ["confirmTicket", () => api.confirmTicket(42, { expected_version: 1 }), "/api/tickets/42/confirm"],
    ["reworkTicket", () => api.reworkTicket(42, { reason: "still leaking", expected_version: 1 }), "/api/tickets/42/rework"],
    ["cancelTicket", () => api.cancelTicket(42, { reason: "duplicate", expected_version: 1 }), "/api/tickets/42/cancel"],
    ["createComment", () => api.createComment(42, { body: "hi", visibility: "PUBLIC" }), "/api/tickets/42/comments"],
    ["downloadAttachment", () => api.downloadAttachment(9), "/api/attachments/9"],
    ["listActiveLocations", () => api.listActiveLocations(), "/api/locations"],
    ["listAdminLocations", () => api.listAdminLocations(), "/api/admin/locations"],
    ["createLocation", () => api.createLocation({ building: "A", floor: "1", room_or_area: "101", active: true }), "/api/admin/locations"],
    ["updateLocation", () => api.updateLocation(3, { active: false }), "/api/admin/locations/3"],
    ["listUsers", () => api.listUsers(), "/api/admin/users"],
    ["setUserActive", () => api.setUserActive(5, { active: false }), "/api/admin/users/5/active"],
    ["getAnalytics", () => api.getAnalytics(), "/api/admin/analytics"],
  ];

  it.each(cases)("%s targets a declared path", async (_name, call, expected) => {
    const url = await recordedUrl(call);
    expect(url.split("?")[0]).toBe(expected);
    const matched = PATHS.some((template) => templateToRegExp(template).test(url));
    expect(matched).toBe(true);
  });

  it("lists with cursor and limit, never page or size", async () => {
    const url = await recordedUrl(() => api.listTickets({ cursor: "c1", limit: 50, status: "CLOSED" }));
    expect(url).toBe("/api/tickets?cursor=c1&limit=50&status=CLOSED");
    expect(url).not.toMatch(/page|total|offset/);
  });

  it("sends an empty first page with no query marker at all", async () => {
    const url = await recordedUrl(() => api.listTickets());
    expect(url).toBe("/api/tickets");
  });

  it("finds technicians through the users endpoint, not an invented one", async () => {
    // The old scaffold called `/api/admin/technicians`, which the contract does not declare.
    const url = await recordedUrl(() => api.listUsers({ role: "TECHNICIAN", active: true }));
    expect(url).toBe("/api/admin/users?role=TECHNICIAN&active=true");
  });

  it("writes locations as a JSON body, not as query parameters", async () => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = init?.body;
        return jsonResponse({}, 201);
      }),
    );
    await api.createLocation({ building: "A", floor: "2", room_or_area: "204", active: true });
    expect(JSON.parse(String(body))).toMatchObject({ building: "A", room_or_area: "204" });
  });

  it("sends the version with every state action", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init?.body);
        return jsonResponse({}, 200);
      }),
    );
    await api.confirmTicket(1, { expected_version: 4 });
    expect(JSON.parse(String(seen[0]))).toEqual({ expected_version: 4 });
  });
});
