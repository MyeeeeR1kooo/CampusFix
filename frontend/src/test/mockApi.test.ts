import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, http, setUnauthorizedHandler } from "../api";
import { installMock } from "../api/mockBridge";
import { MOCK_ACCOUNTS, MOCK_PASSWORD } from "../mocks/fixtures";
import { createMockApi } from "../mocks/responder";
import { createAppQueryClient, queryKeys } from "../lib/queryClient";
import { QueryObserver } from "@tanstack/react-query";
import { EVENT_LABELS } from "../lib/labels";

const instant = new Date("2026-10-03T16:30:00Z");
const login = (id: number) => api.login({ email: MOCK_ACCOUNTS.find((account) => account.id === id)!.email, password: MOCK_PASSWORD });
const report = { title: "Library window latch", description: "The north window latch is loose.", category: "DOORS_WINDOWS_LOCKS" as const, location_id: 2 };
const pngBytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII="), (value) => value.charCodeAt(0));
const photo = () => new File([pngBytes], "window.png", { type: "image/png" });
let mock: ReturnType<typeof createMockApi>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_MOCK", "1");
  mock = createMockApi({ now: () => instant });
  installMock(mock.responder);
  fetchSpy = vi.fn(() => { throw new Error("Unexpected network request"); });
  vi.stubGlobal("fetch", fetchSpy);
  // jsdom cannot decode images. Browser decoding is smoke-tested in the preview;
  // here the native callback is controlled to exercise success and damaged-file failures.
  vi.stubGlobal("Image", class {
    onload?: () => void;
    set src(_url: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:mock-image");
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  installMock(null); setUnauthorizedHandler(null);
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe("mock sessions and visibility — FR-01, FR-04", () => {
  it("uses bare users, rejects invalid/inactive credentials and expires after eight hours", async () => {
    await expect(api.getCurrentUser()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    await expect(api.login({ email: MOCK_ACCOUNTS[0].email, password: "wrong" })).rejects.toMatchObject({ status: 401 });
    await expect(login(6)).rejects.toMatchObject({ status: 401 });
    expect(await login(1)).toMatchObject({ id: 1, role: "REPORTER" });
    expect(await api.getCurrentUser()).toMatchObject({ id: 1 });
    await expect(api.logout()).resolves.toBeUndefined();
    await expect(api.getCurrentUser()).rejects.toMatchObject({ status: 401 });
    let time = instant;
    installMock(createMockApi({ now: () => time }).responder);
    await login(1);
    time = new Date(time.getTime() + 8 * 3600000);
    await expect(api.getCurrentUser()).rejects.toMatchObject({ status: 401 });
  });

  it("restricts lists and details before paging, without exposing email or internal notes", async () => {
    await login(1);
    const page = await api.listTickets();
    expect(page.items).toHaveLength(8);
    expect(page.items.every((ticket) => ticket.reporter.id === 1)).toBe(true);
    expect(page.items[0]).not.toHaveProperty("description");
    expect(page.items[0].reporter).not.toHaveProperty("email");
    await expect(api.getTicket(9)).rejects.toMatchObject({ status: 404 });
    expect((await api.getTicket(1)).timeline.every((entry) => entry.visibility === "PUBLIC")).toBe(true);
    await login(2);
    expect((await api.listTickets()).items.map((ticket) => ticket.id).sort()).toEqual([3, 4, 5, 6]);
    expect((await api.getTicket(6)).allowed_actions).toEqual([]);
    await expect(api.startTicket(10, { expected_version: 3 })).rejects.toMatchObject({ status: 404 });
    await login(3);
    expect((await api.listTickets()).items).toHaveLength(10);
    expect((await api.getTicket(1)).timeline.some((entry) => entry.visibility === "ADMIN_ONLY")).toBe(true);
  });

  it("does not infer action permissions from responsibility alone", async () => {
    await login(1);
    expect(await api.getTicket(1)).toMatchObject({ current_responsible_role: "ADMIN", next_action: "REVIEW", allowed_actions: ["COMMENT_PUBLIC", "CANCEL"] });
    await expect(api.reviewTicket(1, { decision: "APPROVE", category: "HVAC", priority: "LOW", expected_version: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(api.listTickets({ current_assignee_id: 2 })).rejects.toMatchObject({ status: 403 });
    await expect(api.getAnalytics()).rejects.toMatchObject({ status: 403 });
  });

  it.each([1, 2])("returns role-only 403 envelopes for restricted GETs as user %s — #46 009f7f3", async (userId) => {
    await login(userId);
    for (const path of ["/api/tickets?current_assignee_id=2", "/api/admin/locations", "/api/admin/users", "/api/admin/analytics"]) {
      const response = await mock.responder({ method: "GET", path });
      expect(response?.status).toBe(403);
      expect(await response!.json()).toMatchObject({ error: {
        code: "FORBIDDEN", request_id: response!.headers.get("X-Request-ID"), field_errors: [],
      } });
    }
    expect((await api.listTickets()).items.length).toBeGreaterThan(0);
    expect((await api.listActiveLocations()).items.length).toBeGreaterThan(0);
  });

  it("returns contract errors and fails closed for unsupported API requests", async () => {
    await login(3);
    const response = await mock.responder({ method: "DELETE", path: "/api/tickets/1" });
    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(404);
    const body = await response!.json();
    expect(body.error).toMatchObject({ code: "NOT_FOUND", request_id: response!.headers.get("X-Request-ID"), field_errors: [] });
    expect(await mock.responder({ method: "GET", path: "/health" })).toBeNull();
  });

  it("uses contract request IDs for errors, JSON, downloads and empty responses", async () => {
    const unauthorized = await mock.responder({ method: "GET", path: "/api/me" });
    expect(unauthorized!.headers.get("X-Request-ID")).toMatch(/^req_/);
    expect((await unauthorized!.json()).error.request_id).toBe(unauthorized!.headers.get("X-Request-ID"));
    await login(1);
    const ticket = await api.createTicket({ ...report, photos: [photo()] });
    const detail = await api.getTicket(ticket.id);
    for (const path of ["/api/tickets", detail.report_photos[0].download_url]) {
      const response = await mock.responder({ method: "GET", path });
      expect(response!.status).toBe(200);
      expect(response!.headers.get("X-Request-ID")).toMatch(/^req_/);
    }
    const logout = await mock.responder({ method: "POST", path: "/api/auth/logout" });
    expect(logout!.status).toBe(204);
    expect(logout!.headers.get("X-Request-ID")).toMatch(/^req_/);
    expect(await logout!.text()).toBe("");
  });
});

describe("partner review: seeded details and failure envelopes", () => {
  it("downloads both seeded photo purposes without an upload, preserving visibility and later IDs", async () => {
    await login(1);
    const seeded = [];
    for (const id of [5, 6]) {
      const ticket = await api.getTicket(id);
      expect(ticket.report_photos.length).toBeGreaterThan(0);
      expect(ticket.resolution_photos.length).toBeGreaterThan(0);
      for (const attachment of [...ticket.report_photos, ...ticket.resolution_photos]) {
        const response = await mock.responder({ method: "GET", path: attachment.download_url });
        expect(response!.status).toBe(200);
        expect(response!.headers.get("Content-Type")).toBe(attachment.mime);
        const bytes = new Uint8Array(await response!.arrayBuffer());
        expect(bytes.byteLength).toBe(attachment.size);
        expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        seeded.push(attachment);
      }
    }
    expect(new Set(seeded.map((attachment) => attachment.id)).size).toBe(seeded.length);
    const created = await api.createTicket({ ...report, photos: [photo()] });
    const uploaded = (await api.getTicket(created.id)).report_photos[0];
    expect(seeded.map((attachment) => attachment.id)).not.toContain(uploaded.id);
    const original = await mock.responder({ method: "GET", path: seeded[0].download_url });
    expect((await original!.arrayBuffer()).byteLength).toBe(seeded[0].size);
    for (const userId of [2, 3]) {
      await login(userId);
      for (const attachment of seeded) await expect(api.downloadAttachment(attachment.id)).resolves.toBeInstanceOf(Blob);
    }
    await login(4);
    for (const attachment of seeded) await expect(api.downloadAttachment(attachment.id)).rejects.toMatchObject({ status: 404 });
    await api.logout();
    await expect(api.downloadAttachment(seeded[0].id)).rejects.toMatchObject({ status: 401 });
    installMock(createMockApi({ now: () => instant, emptyTickets: true }).responder);
    await login(3);
    await expect(api.downloadAttachment(seeded[0].id)).rejects.toMatchObject({ status: 404 });
  });

  it("seeds public comments and all event types while keeping P0 assignments open", async () => {
    await login(1);
    const reporterDetail = await api.getTicket(5);
    expect(reporterDetail.timeline.some((entry) => entry.kind === "COMMENT" && entry.visibility === "PUBLIC")).toBe(true);
    expect(reporterDetail.timeline.every((entry) => entry.visibility === "PUBLIC")).toBe(true);
    await login(3);
    const details = await Promise.all((await api.listTickets()).items.map((ticket) => api.getTicket(ticket.id)));
    const eventTypes = new Set(details.flatMap((ticket) => ticket.timeline.filter((entry) => entry.kind === "EVENT").map((event) => event.type)));
    expect([...eventTypes].sort()).toEqual(Object.keys(EVENT_LABELS).sort());
    const closed = details.find((ticket) => ticket.id === 6)!;
    const events = closed.timeline.filter((entry) => entry.kind === "EVENT");
    expect(events.slice(-4).map((event) => event.type)).toEqual(["RESOLUTION_SUBMITTED", "REWORK_REQUESTED", "RESOLUTION_SUBMITTED", "TICKET_CLOSED"]);
    expect(events.find((event) => event.type === "REWORK_REQUESTED")).toMatchObject({
      actor: closed.reporter, from_status: "PENDING_CONFIRMATION", to_status: "IN_PROGRESS", note: expect.any(String),
    });
    expect(closed.version).toBe(events.length);
    expect(closed.current_assignee).not.toBeNull();
    expect(closed.assignments).toHaveLength(1);
    expect(details.flatMap((ticket) => ticket.assignments).every((assignment) => assignment.ended_at === null)).toBe(true);
    expect(details.find((ticket) => ticket.id === 5)!.timeline.some((entry) => entry.visibility === "ADMIN_ONLY")).toBe(true);
  });

  it("wraps unexpected errors safely and lets the next queued request recover", async () => {
    const clock = vi.fn(() => instant);
    const isolated = createMockApi({ now: clock });
    installMock(isolated.responder);
    await login(1);
    const fail = () => { throw new Error("Private database path and stack must not escape"); };
    clock.mockImplementationOnce(fail);
    const failed = isolated.responder({ method: "GET", path: "/api/tickets" });
    const recovery = api.listTickets();
    const response = await failed;
    expect(response!.status).toBe(500);
    expect(await response!.json()).toEqual({ error: {
      code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id: response!.headers.get("X-Request-ID"), field_errors: [],
    } });
    expect(response!.headers.get("X-Request-ID")).toMatch(/^req_/);
    expect((await recovery).items).toHaveLength(8);
    clock.mockImplementationOnce(fail);
    await expect(api.listTickets()).rejects.toMatchObject({ status: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." });
  });

  it.each([
    ["GET", "/api/tickets/{id}"], ["GET", "/api/attachments/{id}"],
    ["PATCH", "/api/admin/locations/{id}"], ["PATCH", "/api/admin/users/{id}/active"],
    ...["review", "assign", "start", "resolve", "confirm", "rework", "cancel", "comments"].map((action) => ["POST", `/api/tickets/{id}/${action}`]),
  ])("returns path validation errors for %s %s without mutating data", async (method, route) => {
    await login(3);
    const before = await api.getTicket(1);
    for (const id of ["abc", "0", "-1", "1.5"]) {
      const response = await mock.responder({ method, path: route.replace("{id}", id), json: { active: false } });
      expect(response!.status).toBe(422);
      expect((await response!.json()).error).toMatchObject({
        code: "VALIDATION_ERROR", request_id: response!.headers.get("X-Request-ID"),
        field_errors: [{ field: "path.id", message: expect.any(String), type: expect.any(String) }],
      });
    }
    expect(await api.getTicket(1)).toEqual(before);
  });

  it("keeps unknown routes, unsupported methods and absent valid IDs as 404", async () => {
    await login(3);
    for (const [method, path] of [
      ["GET", "/api/tickets/999999"], ["GET", "/api/attachments/999999"],
      ["PATCH", "/api/admin/locations/999999"], ["PATCH", "/api/admin/users/999999/active"],
      ["POST", "/api/tickets/abc/not-an-action"], ["GET", "/api/tickets/abc/review"], ["DELETE", "/api/tickets/abc"],
    ]) expect((await mock.responder({ method, path }))!.status).toBe(404);
  });
});

describe("mock filters and cursor contract — FR-04", () => {
  it("matches the code or title separately, not across their concatenation", async () => {
    await login(3);
    const ticket = await api.getTicket(1);
    expect((await api.listTickets({ q: ticket.code })).items.map((item) => item.id)).toEqual([1]);
    expect((await api.listTickets({ q: `${ticket.code} ${ticket.title}` })).items).toEqual([]);
  });

  it("ANDs filters with inclusive/exclusive time bounds and no made-up total", async () => {
    await login(3);
    const ticket = await api.getTicket(10);
    if (ticket.priority === null) throw new Error("The assigned fixture must have a priority");
    const result = await api.listTickets({ status: ticket.status, category: ticket.category, priority: ticket.priority,
      building: "Teaching Building A", current_assignee_id: 5, q: ticket.code, created_from: ticket.created_at,
      created_before: new Date(Date.parse(ticket.created_at) + 1).toISOString() });
    expect(result.items.map((item) => item.id)).toEqual([10]);
    expect(Object.keys(result).sort()).toEqual(["items", "next_cursor"]);
    expect(await api.listTickets({ created_before: ticket.created_at, q: ticket.code })).toEqual({ items: [], next_cursor: null });
    expect((await api.listTickets({ q: "no match" })).items).toEqual([]);
  });

  it("uses stable keyset cursors and rejects mismatched filters, roles and malformed values", async () => {
    await login(3);
    const first = await api.listTickets({ limit: 2 });
    expect(first.items.map((ticket) => ticket.id)).toEqual([10, 9]);
    if (first.next_cursor === null) throw new Error("Expected another page after the first two tickets");
    const second = await api.listTickets({ limit: 2, cursor: first.next_cursor });
    expect(second.items.map((ticket) => ticket.id)).toEqual([8, 7]);
    await expect(api.listTickets({ cursor: first.next_cursor, status: "CLOSED" })).rejects.toMatchObject({ status: 400, fields: { cursor: expect.any(String) } });
    await expect(api.listTickets({ cursor: "forged" })).rejects.toMatchObject({ status: 400 });
    await expect(api.listTickets({ limit: 101 })).rejects.toMatchObject({ status: 422 });
    await login(1);
    await expect(api.listTickets({ cursor: first.next_cursor })).rejects.toMatchObject({ status: 400 });
    const own = await api.listTickets({ limit: 2 });
    if (own.next_cursor === null) throw new Error("Expected another page of the reporter's tickets");
    await api.createTicket(report);
    expect((await api.listTickets({ limit: 2, cursor: own.next_cursor })).items.map((ticket) => ticket.id)).toEqual([6, 5]);
  });
});

describe("Shanghai ticket dates — FR-02; updated #46 contract", () => {
  it.each([
    ["2026-10-03T15:59:59.999Z", "20261003", "2026-10-03"],
    ["2026-10-03T16:00:00.000Z", "20261004", "2026-10-04"],
    ["2026-10-31T16:00:00.000Z", "20261101", "2026-11-01"],
    ["2026-12-31T16:00:00.000Z", "20270101", "2027-01-01"],
  ])("uses the Shanghai day at %s for new codes and daily counts", async (utc, codeDay, trendDay) => {
    installMock(createMockApi({ now: () => new Date(utc), emptyTickets: true }).responder);
    await login(1);
    const ticket = await api.createTicket(report);
    expect(ticket).toMatchObject({ code: `CF-${codeDay}-000001`, created_at: utc, updated_at: utc });
    expect((await api.getTicket(ticket.id)).timeline[0].created_at).toBe(utc);
    await login(3);
    expect((await api.getAnalytics()).daily_trend.at(-1)).toEqual({ date: trendDay, created_count: 1, closed_count: 0 });
  });

  it.each([
    ["2026-10-03T15:59:59.999Z", "20260921", "2026-09-21T15:59:59.999Z"],
    ["2026-10-03T16:00:00.000Z", "20260922", "2026-09-21T16:00:00.000Z"],
  ])("uses the Shanghai creation day for seeded codes at %s", async (utc, codeDay, createdAt) => {
    installMock(createMockApi({ now: () => new Date(utc) }).responder);
    await login(1);
    const ticket = await api.getTicket(1);
    expect(ticket).toMatchObject({ code: `CF-${codeDay}-000001`, created_at: createdAt });
    expect(ticket.timeline[0].created_at).toBe(createdAt);
  });
});

describe("mutable workflow — FR-02, FR-05–09; UC-01–04", () => {
  it("rejects a location disabled after selection with a conflict and no creation side effects", async () => {
    installMock(createMockApi({ now: () => instant, emptyTickets: true }).responder);
    await login(1);
    expect((await api.listActiveLocations()).items.some((location) => location.id === report.location_id)).toBe(true);
    await login(3);
    await api.updateLocation(report.location_id, { active: false });
    await login(1);

    await expect(api.createTicket({ ...report, photos: [photo()] })).rejects.toMatchObject({
      status: 409, code: "CONFLICT", requestId: expect.stringMatching(/^req_/), fieldErrors: [],
    });
    expect(await api.listTickets()).toEqual({ items: [], next_cursor: null });
    await expect(api.getTicket(1)).rejects.toMatchObject({ status: 404 });
    await expect(api.downloadAttachment(1)).rejects.toMatchObject({ status: 404 });
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await login(3);
    await api.updateLocation(report.location_id, { active: true });
    await login(1);
    const ticket = await api.createTicket({ ...report, photos: [photo()] });
    expect(ticket).toMatchObject({ id: 1, status: "SUBMITTED", version: 1 });
    const detail = await api.getTicket(ticket.id);
    expect(detail.timeline).toHaveLength(1);
    expect(detail.timeline[0]).toMatchObject({ kind: "EVENT", type: "TICKET_SUBMITTED" });
    expect(detail.report_photos).toHaveLength(1);
    expect(detail.report_photos[0].id).toBe(1);
    expect((await api.downloadAttachment(1)).size).toBe(pngBytes.length);
  });

  it("keeps a nonexistent location as a field validation error without creating a ticket", async () => {
    await login(1);
    const before = await api.listTickets();
    await expect(api.createTicket({ ...report, location_id: 999 })).rejects.toMatchObject({
      status: 422, code: "VALIDATION_ERROR", fields: { location_id: expect.any(String) },
    });
    expect(await api.listTickets()).toEqual(before);
  });

  it("preserves valid text and enforces length before any whitespace normalization", async () => {
    await login(1);
    const title = "  Library window latch  ";
    const description = "  Check the latch.\nKeep this line break.\n";
    const ticket = await api.createTicket({ ...report, title, description });
    expect(await api.getTicket(ticket.id)).toMatchObject({ title, description });
    const body = "  Please enter after class.\n";
    expect(await api.createComment(ticket.id, { body, visibility: "PUBLIC" })).toMatchObject({ body });
    await expect(api.createTicket({ ...report, title: ` ${"x".repeat(120)} ` })).rejects.toMatchObject({
      status: 422, fields: { title: expect.any(String) },
    });
  });

  it("runs create → review → assign → start → resolve → rework → resolve → confirm", async () => {
    await login(1);
    let ticket = await api.createTicket(report);
    expect(ticket).toMatchObject({ status: "SUBMITTED", version: 1, priority: null, current_assignee: null, closed_at: null });
    expect(ticket.code).toMatch(/^CF-\d{8}-\d{6}$/);
    await login(3);
    ticket = await api.reviewTicket(ticket.id, { decision: "APPROVE", category: "DOORS_WINDOWS_LOCKS", priority: "HIGH", expected_version: ticket.version });
    ticket = await api.assignTicket(ticket.id, { technician_id: 2, expected_version: ticket.version });
    await login(2);
    ticket = await api.startTicket(ticket.id, { expected_version: ticket.version, note: "On site." });
    ticket = await api.resolveTicket(ticket.id, { expected_version: ticket.version, resolution_note: "Replaced latch." });
    await login(1);
    ticket = await api.reworkTicket(ticket.id, { expected_version: ticket.version, reason: "The handle still sticks." });
    expect(ticket).toMatchObject({ status: "IN_PROGRESS", current_assignee: { id: 2 } });
    await login(2);
    ticket = await api.resolveTicket(ticket.id, { expected_version: ticket.version, resolution_note: "Adjusted alignment." });
    await login(1);
    ticket = await api.confirmTicket(ticket.id, { expected_version: ticket.version });
    expect(ticket).toMatchObject({ status: "CLOSED", version: 8, closed_at: instant.toISOString(), current_assignee: { id: 2 }, allowed_actions: [], next_action: null });
    const result = await api.getTicket(ticket.id);
    expect(result.timeline.filter((entry) => entry.kind === "EVENT").map((entry) => entry.type)).toEqual([
      "TICKET_SUBMITTED", "TICKET_APPROVED", "TICKET_ASSIGNED", "WORK_STARTED", "RESOLUTION_SUBMITTED", "REWORK_REQUESTED", "RESOLUTION_SUBMITTED", "TICKET_CLOSED",
    ]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].ended_at).toBeNull();
  });

  it("supports rejection and cancellation as terminal branches", async () => {
    await login(3);
    await expect(api.reviewTicket(1, { decision: "REJECT", reason: "", expected_version: 1 })).rejects.toMatchObject({ status: 422, fields: { reason: expect.any(String) } });
    expect(await api.reviewTicket(1, { decision: "REJECT", reason: "Outside facilities scope.", expected_version: 1 })).toMatchObject({ status: "REJECTED", version: 2, allowed_actions: [] });
    await login(4);
    expect(await api.cancelTicket(9, { expected_version: 1 })).toMatchObject({ status: "CANCELLED", version: 2, allowed_actions: [] });
    expect((await api.getTicket(9)).timeline.filter((entry) => entry.kind === "EVENT").at(-1)).toMatchObject({ type: "TICKET_CANCELLED" });
  });

  it("rejects invalid assignments without changing state, assignments or events", async () => {
    await login(3);
    const before = await api.getTicket(2);
    for (const technician_id of [1, 6, 999]) {
      await expect(api.assignTicket(2, { technician_id, expected_version: 2 })).rejects.toMatchObject({ status: 422, fields: { technician_id: expect.any(String) } });
      expect(await api.getTicket(2)).toEqual(before);
    }
  });

  it("keeps failed validation and illegal states unchanged", async () => {
    await login(1);
    await expect(api.createTicket({ ...report, title: "", description: "x".repeat(4001) })).rejects.toMatchObject({ status: 422, fields: { title: expect.any(String), description: expect.any(String) } });
    const before = await api.getTicket(5);
    await expect(api.reworkTicket(5, { expected_version: 5, reason: " " })).rejects.toMatchObject({ status: 422 });
    await expect(api.cancelTicket(5, { expected_version: 5 })).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(await api.getTicket(5)).toEqual(before);
    await login(2);
    const processing = await api.getTicket(4);
    await expect(api.resolveTicket(4, { expected_version: 4, resolution_note: "" })).rejects.toMatchObject({ status: 422 });
    await expect(api.startTicket(4, { expected_version: 4 })).rejects.toMatchObject({ status: 409 });
    expect(await api.getTicket(4)).toEqual(processing);
  });

  it.each(["review", "start", "resolve", "confirm"] as const)("accepts exactly one concurrent %s with the same version", async (action) => {
    const operations = {
      review: async () => { await login(3); return { id: 1, run: () => api.reviewTicket(1, { decision: "APPROVE", category: "HVAC", priority: "LOW", expected_version: 1 }) }; },
      start: async () => { await login(2); return { id: 3, run: () => api.startTicket(3, { expected_version: 3 }) }; },
      resolve: async () => { await login(2); return { id: 4, run: () => api.resolveTicket(4, { expected_version: 4, resolution_note: "Done." }) }; },
      confirm: async () => { await login(1); return { id: 5, run: () => api.confirmTicket(5, { expected_version: 5 }) }; },
    };
    const { id, run } = await operations[action]();
    const before = await api.getTicket(id);
    const results = await Promise.allSettled([run(), run()]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { status: 409, code: "TICKET_VERSION_CONFLICT" } });
    const after = await api.getTicket(id);
    expect(after.version).toBe(before.version + 1);
    expect(after.timeline).toHaveLength(before.timeline.length + 1);
  });
});

describe("comments, files, locations and accounts — FR-03, FR-10, FR-12", () => {
  it("restricts internal notes and terminal comments without changing versions", async () => {
    await login(1);
    await expect(api.createComment(1, { body: "Private", visibility: "ADMIN_ONLY" })).rejects.toMatchObject({ status: 403 });
    await expect(api.createComment(1, { body: "x".repeat(2001), visibility: "PUBLIC" })).rejects.toMatchObject({ status: 422 });
    await api.createComment(1, { body: "You may enter after 4 pm.", visibility: "PUBLIC" });
    expect((await api.getTicket(1)).version).toBe(1);
    await login(3);
    await api.createComment(1, { body: "Internal-only text", visibility: "ADMIN_ONLY" });
    await login(1);
    expect(JSON.stringify(await api.getTicket(1))).not.toContain("Internal-only text");
    await expect(api.createComment(6, { body: "Another message", visibility: "PUBLIC" })).rejects.toMatchObject({ status: 409 });
  });

  it("stores and downloads image bytes only for visible tickets", async () => {
    await login(1);
    const ticket = await api.createTicket({ ...report, photos: [photo()] });
    const attachment = (await api.getTicket(ticket.id)).report_photos[0];
    expect(attachment).toMatchObject({ purpose: "REPORT_PHOTO", size: pngBytes.length, download_url: `/api/attachments/${attachment.id}` });
    const blob = await api.downloadAttachment(attachment.id);
    const downloaded = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    expect(new Uint8Array(downloaded)).toEqual(pngBytes);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    await login(4);
    await expect(api.downloadAttachment(attachment.id)).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ["type", () => [new File(["<svg/>"], "image.svg", { type: "image/svg+xml" })], 415],
    ["size", () => [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })], 413],
    ["count", () => Array.from({ length: 6 }, photo), 422],
    ["disguised content", () => [new File(["not a PNG"], "fake.png", { type: "image/png" })], 415],
  ] as const)("rejects invalid image %s without creating a ticket", async (_name, makeFiles, status) => {
    await login(1);
    const before = await api.listTickets();
    await expect(api.createTicket({ ...report, photos: makeFiles() })).rejects.toMatchObject({ status, code: "VALIDATION_ERROR" });
    expect(await api.listTickets()).toEqual(before);
  });

  it("rolls back damaged result uploads and keeps the cumulative limit across rework", async () => {
    await login(2);
    const before = await api.getTicket(4);
    vi.stubGlobal("Image", class { onerror?: () => void; set src(_url: string) { queueMicrotask(() => this.onerror?.()); } });
    await expect(api.resolveTicket(4, { expected_version: 4, resolution_note: "Done", photos: [photo()] })).rejects.toMatchObject({ status: 422 });
    expect(await api.getTicket(4)).toEqual(before);
    vi.stubGlobal("Image", class { onload?: () => void; set src(_url: string) { queueMicrotask(() => this.onload?.()); } });
    await api.resolveTicket(4, { expected_version: 4, resolution_note: "Done", photos: Array.from({ length: 5 }, photo) });
    await login(1);
    await api.reworkTicket(4, { expected_version: 5, reason: "Still rattling." });
    await login(2);
    await expect(api.resolveTicket(4, { expected_version: 6, resolution_note: "Retested", photos: [photo()] })).rejects.toMatchObject({ status: 422 });
    expect((await api.getTicket(4)).resolution_photos).toHaveLength(5);
    expect((await api.getTicket(4)).version).toBe(6);
  });

  it("supports location pages, unique edits, disabling and immutable ticket snapshots", async () => {
    await login(3);
    expect((await api.listAdminLocations()).items).toHaveLength(4);
    expect((await api.listActiveLocations()).items).toHaveLength(3);
    const before = await api.getTicket(1);
    const location = await api.createLocation({ building: "Lab C", floor: "1", room_or_area: "101", active: true });
    await expect(api.createLocation({ building: "Lab C", floor: "1", room_or_area: "101", active: true })).rejects.toMatchObject({ status: 409 });
    await expect(api.updateLocation(location.id, { building: "Teaching Building A", floor: "3", room_or_area: "301" })).rejects.toMatchObject({ status: 409 });
    await api.createLocation({ building: "A / B", floor: "C", room_or_area: "D", active: true });
    await expect(api.createLocation({ building: "A", floor: "B / C", room_or_area: "D", active: true })).resolves.toMatchObject({ building: "A" });
    await api.updateLocation(1, { building: "Renamed A", active: false });
    expect((await api.getTicket(1)).location_label_snapshot).toBe(before.location_label_snapshot);
    expect((await api.listTickets({ building: "Renamed A" })).items.some((ticket) => ticket.id === 1)).toBe(true);
    await login(1);
    await expect(api.createTicket({ ...report, location_id: 1 })).rejects.toMatchObject({ status: 409, code: "CONFLICT", fieldErrors: [] });
  });

  it("lists managed accounts and disallows Admin management and inactive logins", async () => {
    await login(3);
    expect((await api.listUsers({ role: "TECHNICIAN", active: true })).items.map((user) => user.id)).toEqual([5, 2]);
    await expect(api.setUserActive(3, { active: false })).rejects.toMatchObject({ status: 403 });
    await api.setUserActive(2, { active: false });
    await expect(login(2)).rejects.toMatchObject({ status: 401 });
    expect((await api.getTicket(3)).current_assignee?.id).toBe(2);
    await api.setUserActive(2, { active: true });
    await expect(login(2)).resolves.toMatchObject({ active: true });
  });
});

describe("statistics and scaffold integration — FR-11 / UC-05 / §13.3", () => {
  it("updates all aggregates and builds a Shanghai 30-day zero-filled series", async () => {
    await login(3);
    const before = await api.getAnalytics();
    expect(before.daily_trend).toHaveLength(30);
    expect(before.daily_trend.at(-1)?.date).toBe("2026-10-04");
    expect(before.by_status.reduce((sum, row) => sum + row.count, 0)).toBe(10);
    expect(before.backlog_count).toBe(7);
    await login(1);
    await api.confirmTicket(5, { expected_version: 5 });
    await login(3);
    const after = await api.getAnalytics();
    expect(after.backlog_count).toBe(6);
    expect(after.by_status.find((row) => row.status === "CLOSED")?.count).toBe(2);
    expect(after.daily_trend.at(-1)?.closed_count).toBe(1);
    expect(after.average_close_seconds).toBeGreaterThan(before.average_close_seconds);
    installMock(createMockApi({ now: () => instant, emptyTickets: true }).responder);
    await login(3);
    const empty = await api.getAnalytics();
    expect(empty.backlog_count).toBe(0); expect(empty.average_close_seconds).toBe(0);
    expect(empty.by_building).toEqual([]);
    expect(empty.daily_trend.every((row) => row.created_count === 0 && row.closed_count === 0)).toBe(true);
  });

  it("passes expired sessions through the existing unauthorized handler", async () => {
    await login(1);
    const clear = vi.fn(); setUnauthorizedHandler(clear);
    mock.expireSession();
    await expect(api.listTickets()).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
  });

  it("uses the existing 409 notification and re-fetches authoritative details", async () => {
    await login(1);
    const notify = vi.fn();
    const client = createAppQueryClient({ notify });
    const observer = new QueryObserver(client, { queryKey: queryKeys.tickets.detail(1), queryFn: () => api.getTicket(1) });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    await api.cancelTicket(1, { expected_version: 1 });
    const mutation = client.getMutationCache().build(client, { mutationFn: ({ id }: { id: number }) => api.cancelTicket(id, { expected_version: 1 }) });
    await expect(mutation.execute({ id: 1 })).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(client.getQueryData(queryKeys.tickets.detail(1))).toMatchObject({ status: "CANCELLED", version: 2 }));
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe(); client.clear();
  });

  it("leaves the real API address untouched when the mock switch is off", async () => {
    vi.stubEnv("VITE_USE_MOCK", "0");
    const realTransport = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", realTransport);
    expect(await http.get("/api/me")).toEqual({ ok: true });
    expect(realTransport.mock.calls).toHaveLength(1);
    expect((realTransport.mock.calls[0] as unknown[])[0]).toBe("/api/me");
  });
});
