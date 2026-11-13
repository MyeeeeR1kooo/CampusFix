#!/usr/bin/env node
/**
 * Replayable real-backend smoke test for #51/#54 (no extra dependencies).
 *
 * It drives the published HTTP API against a running Compose stack and checks
 * the reporter flow end to end: create with/without photo, list filters and
 * cursors, details, authorized download, comments, internal-note privacy,
 * cross-user isolation, location-snapshot retention, cancellation and the
 * terminal-comment conflict.
 *
 * This is API-level evidence for the real stack. The browser UI is covered by
 * the component suite and the manual browser record in
 * docs/verification/2026-10-24-issue51-54-frontend-e2e.md.
 *
 * Usage (fresh isolated Compose project recommended):
 *   BASE_URL=http://localhost:8090 \
 *   SEED_REPORTER_PASSWORD=... SEED_TECHNICIAN_PASSWORD=... SEED_ADMIN_PASSWORD=... \
 *   node tests/e2e/reporter-flow-smoke.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = (process.env.BASE_URL ?? "http://localhost:8090").replace(/\/$/, "");
const ORIGIN = BASE;
const PASSWORDS = {
  REPORTER: process.env.SEED_REPORTER_PASSWORD,
  TECHNICIAN: process.env.SEED_TECHNICIAN_PASSWORD,
  ADMIN: process.env.SEED_ADMIN_PASSWORD,
};
for (const [role, password] of Object.entries(PASSWORDS)) {
  if (!password) {
    throw new Error(`Set SEED_${role}_PASSWORD to the password used when seeding the stack.`);
  }
}
const EMAILS = {
  REPORTER: process.env.SEED_REPORTER_EMAIL ?? "reporter@example.invalid",
  TECHNICIAN: process.env.SEED_TECHNICIAN_EMAIL ?? "technician@example.invalid",
  ADMIN: process.env.SEED_ADMIN_EMAIL ?? "admin@example.invalid",
};
const PHOTO = await readFile(fileURLToPath(new URL("./fixtures/photo.png", import.meta.url)));
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function json(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function expectStatus(response, status, label) {
  const text = await response.text();
  assert.equal(response.status, status, `${label}: expected ${status}, got ${response.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function login(role) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ email: EMAILS[role], password: PASSWORDS[role] }),
  });
  const user = await json(response, 200, `login ${role}`);
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
  assert.ok(setCookie, `login ${role}: no session cookie`);
  return { cookie: setCookie.split(";")[0], user };
}

async function call(session, path, { method = "GET", body, form } = {}) {
  const headers = { Cookie: session.cookie };
  if (method !== "GET") headers.Origin = ORIGIN;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

function ticketForm(title, locationId) {
  const form = new FormData();
  form.set("title", title);
  form.set("description", "Replayable E2E description for the reporter and attachment flow.");
  form.set("category", "DOORS_WINDOWS_LOCKS");
  form.set("location_id", String(locationId));
  return form;
}

const stamp = Date.now();
let originalLocation;
let locationId;
let result;
let failure;

try {
  // 1. Health and three-role login.
  await json(await fetch(`${BASE}/health`), 200, "health");
  const reporter = await login("REPORTER");
  const technician = await login("TECHNICIAN");
  const admin = await login("ADMIN");
  assert.equal(reporter.user.role, "REPORTER");
  assert.equal(technician.user.role, "TECHNICIAN");
  assert.equal(admin.user.role, "ADMIN");

  // 2. Create from the demo data and keep the original location for restore.
  const locations = await json(await call(admin, "/api/admin/locations?limit=100"), 200, "admin locations");
  const active = locations.items.find((location) => location.active);
  assert.ok(active, "no active seeded location");
  locationId = active.id;
  originalLocation = {
    building: active.building,
    floor: active.floor,
    room_or_area: active.room_or_area,
    active: active.active,
  };
  const originalLabel = `${originalLocation.building} / ${originalLocation.floor} / ${originalLocation.room_or_area}`;

  // 3. Create with a photo as one multipart request.
  const title = `E2E reporter flow ${stamp}`;
  const form = ticketForm(title, locationId);
  form.append("photos", new Blob([PHOTO], { type: "image/png" }), "e2e-photo.png");
  const created = await json(await call(reporter, "/api/tickets", { method: "POST", form }), 201, "create ticket");
  assert.match(created.code, /^CF-\d{8}-\d{6}$/);
  assert.equal(created.status, "SUBMITTED");
  assert.equal(created.version, 1);
  assert.equal(created.location_label_snapshot, originalLabel);
  assert.equal(created.reporter.id, reporter.user.id);

  // 4. Details, attachment authorization and event timeline.
  const detail = await json(await call(reporter, `/api/tickets/${created.id}`), 200, "ticket detail");
  assert.equal(detail.status, "SUBMITTED");
  assert.equal(detail.report_photos.length, 1);
  assert.equal(detail.resolution_photos.length, 0);
  assert.ok(detail.timeline.some((entry) => entry.kind === "EVENT" && entry.type === "TICKET_SUBMITTED"));
  const attachment = detail.report_photos[0];
  const bytesResponse = await call(reporter, `/api/attachments/${attachment.id}`);
  assert.equal(bytesResponse.status, 200, "authorized attachment download");
  const bytes = new Uint8Array(await bytesResponse.arrayBuffer());
  assert.equal(bytes.length, PHOTO.length);
  assert.deepEqual([...bytes.slice(0, 8)], PNG_SIGNATURE);
  await expectStatus(await call(technician, `/api/attachments/${attachment.id}`), 404, "technician attachment isolation");

  // 5. Public comment, internal-note privacy and cross-user isolation.
  const publicBody = `Public E2E note ${stamp}`;
  const internalBody = `Admin-only E2E note ${stamp}`;
  await json(await call(reporter, `/api/tickets/${created.id}/comments`, {
    method: "POST", body: { body: publicBody, visibility: "PUBLIC" },
  }), 201, "public comment");
  await expectStatus(await call(reporter, `/api/tickets/${created.id}/comments`, {
    method: "POST", body: { body: "not allowed", visibility: "ADMIN_ONLY" },
  }), 403, "reporter internal note");
  await json(await call(admin, `/api/tickets/${created.id}/comments`, {
    method: "POST", body: { body: internalBody, visibility: "ADMIN_ONLY" },
  }), 201, "admin internal note");
  const reporterBefore = JSON.stringify(await json(await call(reporter, `/api/tickets/${created.id}`), 200, "reporter detail"));
  assert.ok(reporterBefore.includes(publicBody));
  assert.ok(!reporterBefore.includes(internalBody));
  const adminDetail = JSON.stringify(await json(await call(admin, `/api/tickets/${created.id}`), 200, "admin detail"));
  assert.ok(adminDetail.includes(internalBody));
  await expectStatus(await call(technician, `/api/tickets/${created.id}`), 404, "technician ticket isolation");

  // 6. List visibility, status/query filters and cursor pagination (20 + rest).
  const pageTicketIds = [];
  for (let index = 0; index < 21; index += 1) {
    const pageForm = ticketForm(`E2E page ${stamp} ${String(index).padStart(2, "0")}`, locationId);
    const pageTicket = await json(
      await call(reporter, "/api/tickets", { method: "POST", form: pageForm }),
      201,
      `page ticket ${index}`,
    );
    pageTicketIds.push(pageTicket.id);
  }
  const firstPage = await json(await call(reporter, "/api/tickets?limit=20"), 200, "first page");
  assert.equal(firstPage.items.length, 20);
  assert.ok(firstPage.next_cursor, "first page must have a cursor");
  const secondPage = await json(
    await call(reporter, `/api/tickets?limit=20&cursor=${encodeURIComponent(firstPage.next_cursor)}`),
    200,
    "second page",
  );
  assert.ok(secondPage.items.length >= 1, "second page must contain the remainder");
  assert.equal(firstPage.items.some((item) => secondPage.items.some((other) => other.id === item.id)), false);
  assert.equal(firstPage.items.some((item) => item.reporter.id !== reporter.user.id), false);
  const byCode = await json(await call(reporter, `/api/tickets?q=${encodeURIComponent(created.code)}`), 200, "code search");
  assert.ok(byCode.items.some((item) => item.id === created.id));

  // 7. Location rename/disable keeps the creation-time snapshot.
  await json(await call(admin, `/api/admin/locations/${locationId}`, {
    method: "PATCH", body: { building: "Renamed E2E Building", active: false },
  }), 200, "rename and disable location");
  const afterRename = await json(await call(reporter, `/api/tickets/${created.id}`), 200, "detail after rename");
  assert.equal(afterRename.location_label_snapshot, originalLabel);
  const activeLocations = await json(await call(reporter, "/api/locations?limit=100"), 200, "active locations");
  assert.equal(activeLocations.items.some((location) => location.id === locationId), false);

  // 8. Cancel before review and terminal read-only behavior.
  const beforeCancel = await json(await call(reporter, `/api/tickets/${created.id}`), 200, "detail before cancel");
  const cancelled = await json(await call(reporter, `/api/tickets/${created.id}/cancel`, {
    method: "POST", body: { expected_version: beforeCancel.version, reason: "Replayable E2E cancellation" },
  }), 200, "cancel ticket");
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.version, beforeCancel.version + 1);
  assert.deepEqual(cancelled.allowed_actions, []);
  const terminal = await json(await call(reporter, `/api/tickets/${created.id}`), 200, "terminal detail");
  assert.equal(terminal.report_photos.length, 1);
  assert.ok(terminal.timeline.some((entry) => entry.kind === "COMMENT" && entry.body === publicBody));
  assert.ok(terminal.timeline.some((entry) => entry.kind === "EVENT" && entry.type === "TICKET_CANCELLED"));
  const conflict = await expectStatus(await call(reporter, `/api/tickets/${created.id}/comments`, {
    method: "POST", body: { body: "too late", visibility: "PUBLIC" },
  }), 409, "terminal comment");
  assert.equal(conflict.error.code, "CONFLICT");
  const afterConflict = await json(await call(reporter, `/api/tickets/${created.id}`), 200, "detail after conflict");
  assert.equal(afterConflict.version, cancelled.version);
  assert.equal(afterConflict.timeline.filter((entry) => entry.kind === "COMMENT").length, 1);
  const cancelledList = await json(await call(reporter, "/api/tickets?status=CANCELLED&limit=100"), 200, "cancelled list");
  assert.ok(cancelledList.items.every((item) => item.status === "CANCELLED"));
  assert.ok(cancelledList.items.some((item) => item.id === created.id));
  assert.equal(
    cancelledList.items.some((item) => pageTicketIds.includes(item.id)),
    false,
    "CANCELLED filter must not contain the script's still-SUBMITTED page tickets",
  );

  result = {
    result: "PASS",
    ticket: created.code,
    attachment: { id: attachment.id, bytes: bytes.length, mime: attachment.mime },
    comments: { public: publicBody, internalHiddenFromReporter: true },
    pagination: { first: firstPage.items.length, second: secondPage.items.length },
    locationSnapshot: originalLabel,
    terminal: cancelled.status,
  };
} catch (error) {
  failure = error;
} finally {
  // Restore the demo location so the script can be replayed against the same stack.
  if (originalLocation && locationId) {
    try {
      const admin = await login("ADMIN");
      const restored = await json(
        await call(admin, `/api/admin/locations/${locationId}`, {
          method: "PATCH", body: originalLocation,
        }),
        200,
        "restore location",
      );
      assert.deepEqual(
        {
          building: restored.building,
          floor: restored.floor,
          room_or_area: restored.room_or_area,
          active: restored.active,
        },
        originalLocation,
        "restored location must match its original fields",
      );
    } catch (error) {
      failure ??= error;
    }
  }
}

if (failure) throw failure;
console.log(JSON.stringify(result, null, 2));
