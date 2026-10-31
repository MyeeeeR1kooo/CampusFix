/**
 * Real #52/#53 browser/API integration. Requires an isolated DB prepared with
 * dispatch-fixtures.py, production frontend (VITE_USE_MOCK=0), and Playwright.
 * See docs/verification/2026-10-31-issues-52-53-integration/README.md.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright");
const base = process.env.BASE_URL ?? "http://127.0.0.1:41752";
const output = resolve(process.env.RESULT_DIR ?? "docs/verification/2026-10-31-issues-52-53-integration");
const passwords = {
  ADMIN: process.env.SEED_ADMIN_PASSWORD, REPORTER: process.env.SEED_REPORTER_PASSWORD,
  TECHNICIAN: process.env.SEED_TECHNICIAN_PASSWORD,
};
assert.ok(Object.values(passwords).every(Boolean), "Set all three SEED_*_PASSWORD variables.");
await mkdir(output, { recursive: true });
const result = { started_at: new Date().toISOString(), base_url: base, scenarios: [], network: [], page_errors: [], tickets: {} };
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
let currentPage;
async function session(role, email = role.toLowerCase() + "@example.invalid") {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  currentPage = page;
  page.on("pageerror", (error) => result.page_errors.push({ role, message: error.message }));
  page.on("response", (response) => {
    const request = response.request(), url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    const entry = { role, method: request.method(), path: url.pathname + url.search, status: response.status() };
    // Exclude login bodies, cookies, tokens and headers from saved evidence.
    if (/\/(review|assign)$/.test(url.pathname)) entry.body = request.postDataJSON();
    result.network.push(entry);
  });
  await page.goto("/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(passwords[role]);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  return { context, page };
}
async function api(actor, path, { method = "GET", data, multipart, status = 200 } = {}) {
  const response = await actor.context.request.fetch(base + path, {
    method, data, multipart, headers: method === "GET" ? {} : { Origin: base },
  });
  assert.equal(response.status(), status, method + " " + path + ": " + await response.text());
  return response.status() === 204 ? null : response.json();
}
async function scenario(name, page, action) {
  currentPage = page;
  const started = Date.now();
  try {
    await action();
    result.scenarios.push({ name, result: "PASS", duration_ms: Date.now() - started });
    console.log("PASS " + name);
  } catch (error) {
    result.scenarios.push({ name, result: "FAIL", error: error.message });
    throw error;
  }
}
const shot = (page, filename) => page.screenshot({ path: resolve(output, filename), fullPage: true });
const ticketPath = (ticket) => "/api/tickets/" + ticket.id;
async function openTicket(page, ticket) {
  await page.goto("/tickets/" + ticket.id);
  await page.getByRole("heading", { name: ticket.title, exact: true }).waitFor();
}
async function dialog(page, action) {
  await page.getByRole("button", { name: action, exact: true }).click();
  const box = page.getByRole("dialog");
  await box.waitFor();
  return box;
}
async function submit(page, box, name, ticket, action, status = 200) {
  const pending = page.waitForResponse((r) => new URL(r.url()).pathname === ticketPath(ticket) + "/" + action && r.request().method() === "POST");
  await box.getByRole("button", { name, exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), status, await response.text());
  if (status === 200 || status === 409) await box.waitFor({ state: "hidden" });
  return response.json();
}
async function approve(page, ticket, priority = "HIGH") {
  await openTicket(page, ticket);
  const box = await dialog(page, "Review");
  await box.getByLabel("Category", { exact: false }).selectOption("HVAC");
  await box.getByLabel("Priority", { exact: false }).selectOption(priority);
  return submit(page, box, "Approve", ticket, "review");
}
async function state(admin, ticket, status, version, assignments, events) {
  const detail = await api(admin, ticketPath(ticket));
  assert.equal(detail.status, status);
  assert.equal(detail.version, version);
  assert.equal(detail.assignments.length, assignments);
  assert.equal(detail.timeline.filter((e) => e.kind === "EVENT").length, events);
  return detail;
}
try {
  const admin = await session("ADMIN"), reporter = await session("REPORTER");
  const technician = await session("TECHNICIAN");
  const otherTechnician = await session("TECHNICIAN", "dispatch-tech001@example.invalid");
  const secondAdmin = await session("ADMIN");
  result.browser_version = browser.version();
  const me = await api(technician, "/api/me"), other = await api(otherTechnician, "/api/me");
  const location = (await api(reporter, "/api/locations?limit=100")).items[0];
  let counter = 0;
  async function create(label) {
    const ticket = await api(reporter, "/api/tickets", { method: "POST", status: 201, multipart: {
      title: "Dispatch E2E " + String(++counter).padStart(2, "0") + " " + label,
      description: "Fictional facility repair for isolated dispatch integration testing.",
      category: "FURNITURE", location_id: String(location.id),
    } });
    result.tickets[label] = { id: ticket.id, title: ticket.title };
    return ticket;
  }
  const primary = await create("approve-and-assign"), rejected = await create("reject");
  const staleReview = await create("stale-review"), staleAssign = await create("stale-assign");
  const disabled = await create("disabled-candidate"), noCandidates = await create("no-candidates");

  await scenario("52-review-queue-pagination-and-priority-filter", admin.page, async () => {
    for (let index = 0; index < 16; index++) await create("pagination-" + index);
    await admin.page.goto("/workbench");
    const table = admin.page.getByRole("table", { name: "Review queue", exact: true });
    await table.getByRole("link", { name: /Dispatch E2E/ }).first().waitFor();
    assert.equal(await table.locator("tbody tr").count(), 20);
    const firstTitles = await table.locator("tbody tr").allTextContents();
    const next = admin.page.waitForResponse((r) => r.url().includes("/api/tickets?") && new URL(r.url()).searchParams.has("cursor"));
    await admin.page.getByRole("button", { name: "Next", exact: true }).click();
    assert.equal((await (await next).json()).items.length, 2);
    await table.getByRole("link", { name: primary.title, exact: true }).waitFor();
    assert.ok((await table.locator("tbody tr").allTextContents()).every((title) => !firstTitles.includes(title)));
    await admin.page.getByLabel("Priority", { exact: true }).selectOption("HIGH");
    const filtered = admin.page.waitForResponse((r) => r.url().includes("/api/tickets?") && new URL(r.url()).searchParams.get("priority") === "HIGH");
    await admin.page.getByRole("button", { name: "Apply filters" }).click();
    const response = await filtered;
    assert.equal(new URL(response.url()).searchParams.get("status"), "SUBMITTED");
    assert.equal(new URL(response.url()).searchParams.has("cursor"), false);
    await admin.page.getByText("No tickets in review queue.", { exact: true }).waitFor();
    await admin.page.getByRole("button", { name: "Clear filters" }).click();
    await table.getByRole("link", { name: /Dispatch E2E/ }).first().waitFor();
    await shot(admin.page, "review-queue.png");
  });
  await scenario("52-approve-category-priority-and-queue-transition", admin.page, async () => {
    await admin.page.getByRole("button", { name: "Next", exact: true }).click();
    await admin.page.getByRole("link", { name: primary.title, exact: true }).click();
    const box = await dialog(admin.page, "Review");
    assert.deepEqual(await box.locator("#review-priority option").evaluateAll((options) => options.map((o) => o.value).sort()), ["", "HIGH", "LOW", "MEDIUM"]);
    await box.getByLabel("Category", { exact: false }).selectOption("HVAC");
    await box.getByLabel("Priority", { exact: false }).selectOption("HIGH");
    await submit(admin.page, box, "Approve", primary, "review");
    await admin.page.getByRole("list", { name: "Ticket timeline" }).getByText("Reviewed — approved for assignment", { exact: true }).waitFor();
    const detail = await state(admin, primary, "PENDING_ASSIGNMENT", 2, 0, 2);
    assert.equal(detail.category, "HVAC"); assert.equal(detail.priority, "HIGH"); assert.equal(detail.current_assignee, null);
    assert.equal((await api(admin, "/api/tickets?status=SUBMITTED")).items.some((t) => t.id === primary.id), false);
    await admin.page.getByRole("link", { name: "← Back", exact: true }).click();
    await admin.page.getByRole("link", { name: "Pending assignment", exact: true }).click();
    await admin.page.getByRole("link", { name: primary.title, exact: true }).waitFor();
    await shot(admin.page, "pending-assignment.png");
  });
  await scenario("52-reject-requires-reason-and-records-timeline", admin.page, async () => {
    await openTicket(admin.page, rejected);
    const box = await dialog(admin.page, "Review");
    await box.getByLabel("Decision", { exact: true }).selectOption("REJECT");
    const before = result.network.filter((r) => r.method === "POST" && r.path === ticketPath(rejected) + "/review").length;
    await box.getByRole("button", { name: "Reject", exact: true }).click();
    await box.getByText("Enter a rejection reason.", { exact: true }).waitFor();
    assert.equal(result.network.filter((r) => r.method === "POST" && r.path === ticketPath(rejected) + "/review").length, before);
    await state(admin, rejected, "SUBMITTED", 1, 0, 1);
    const invalid = await api(admin, ticketPath(rejected) + "/review", { method: "POST", status: 422, data: { decision: "REJECT", reason: "", expected_version: 1 } });
    assert.equal(invalid.error.code, "VALIDATION_ERROR");
    await box.getByLabel("Rejection reason", { exact: false }).fill("Fictional repair outside facilities scope");
    await submit(admin.page, box, "Reject", rejected, "review");
    await admin.page.getByRole("list", { name: "Ticket timeline" }).getByText("Fictional repair outside facilities scope", { exact: true }).waitFor();
    await state(admin, rejected, "REJECTED", 2, 0, 2);
    assert.equal(await admin.page.getByRole("button", { name: "Review", exact: true }).count(), 0);
    await shot(admin.page, "rejected-ticket.png");
  });
  await scenario("52-invalid-priority-is-422-without-side-effects", admin.page, async () => {
    const response = await api(admin, ticketPath(staleReview) + "/review", {
      method: "POST", status: 422, data: { decision: "APPROVE", category: "HVAC", priority: "URGENT", expected_version: 1 },
    });
    assert.equal(response.error.code, "VALIDATION_ERROR");
    await state(admin, staleReview, "SUBMITTED", 1, 0, 1);
  });
  await scenario("52-stale-review-refreshes-winning-state", admin.page, async () => {
    await openTicket(admin.page, staleReview);
    const box = await dialog(admin.page, "Review");
    await box.getByLabel("Category", { exact: false }).selectOption("HVAC");
    await box.getByLabel("Priority", { exact: false }).selectOption("LOW");
    await approve(secondAdmin.page, staleReview, "HIGH");
    assert.equal((await submit(admin.page, box, "Approve", staleReview, "review", 409)).error.code, "TICKET_VERSION_CONFLICT");
    await admin.page.getByText(/updated by someone else/i).waitFor();
    await admin.page.getByRole("button", { name: "Assign", exact: true }).waitFor();
    assert.equal((await state(admin, staleReview, "PENDING_ASSIGNMENT", 2, 0, 2)).priority, "HIGH");
  });
  await scenario("53-paginated-candidates-assign-owner-history-timeline", admin.page, async () => {
    await admin.page.goto("/workbench?queue=assignment");
    await admin.page.getByLabel("Priority", { exact: true }).selectOption("HIGH");
    await admin.page.getByRole("button", { name: "Apply filters" }).click();
    await admin.page.getByRole("link", { name: primary.title, exact: true }).click();
    const box = await dialog(admin.page, "Assign");
    await box.getByRole("option", { name: "Demo Technician", exact: true }).waitFor({ state: "attached" });
    assert.equal(await box.locator("#assign-technician option").count(), 103);
    assert.equal(await box.getByRole("option", { name: "Inactive Dispatch Technician", exact: true }).count(), 0);
    assert.equal(await box.getByRole("option", { name: "Demo Dispatcher", exact: true }).count(), 0);
    assert.ok(result.network.some((r) => r.path.startsWith("/api/admin/users?") && new URL(r.path, base).searchParams.has("cursor")));
    await box.getByLabel("Technician", { exact: false }).selectOption(String(me.id));
    await submit(admin.page, box, "Assign", primary, "assign");
    await admin.page.getByRole("region", { name: "Ticket status and responsibility" }).getByText("Demo Technician", { exact: true }).waitFor();
    const history = admin.page.getByRole("table", { name: "Assignment records" });
    await history.getByText("Demo Technician", { exact: true }).waitFor();
    assert.match(await history.textContent(), /Demo Dispatcher/);
    await admin.page.getByRole("list", { name: "Ticket timeline" }).getByText("Assigned", { exact: true }).waitFor();
    const detail = await state(admin, primary, "ASSIGNED", 3, 1, 3);
    assert.equal(detail.current_assignee.id, me.id); assert.equal(detail.assignments[0].ended_at, null);
    await shot(admin.page, "assigned-ticket.png");
    await admin.page.getByRole("link", { name: "← Back", exact: true }).click();
    await admin.page.getByRole("link", { name: "Pending assignment", exact: true }).click();
    await admin.page.getByRole("link", { name: staleReview.title, exact: true }).waitFor();
    await admin.page.getByRole("link", { name: primary.title, exact: true }).waitFor({ state: "hidden" });
  });
  await scenario("53-current-technician-gains-access-and-starts", technician.page, async () => {
    await openTicket(technician.page, primary);
    const box = await dialog(technician.page, "Start work");
    await submit(technician.page, box, "Start work", primary, "start");
    await technician.page.getByRole("list", { name: "Ticket timeline" }).getByText("Processing started", { exact: true }).waitFor();
    await state(admin, primary, "IN_PROGRESS", 4, 1, 4);
    await openTicket(reporter.page, primary);
    assert.equal(await reporter.page.getByRole("button", { name: "Assign", exact: true }).count(), 0);
    await otherTechnician.page.goto("/tickets/" + primary.id);
    await otherTechnician.page.getByRole("heading", { name: "This page is not available", exact: true }).waitFor();
    await api(otherTechnician, ticketPath(primary), { status: 404 });
  });
  await scenario("52-53-non-admin-ui-and-real-api-denial", reporter.page, async () => {
    for (const actor of [reporter, technician]) {
      for (const path of ["/workbench", "/workbench?queue=assignment"]) {
        await actor.page.goto(path);
        await actor.page.getByRole("heading", { name: "You don't have access to this page", exact: true }).waitFor();
      }
      const status = actor === reporter ? 403 : 404;
      await api(actor, ticketPath(staleAssign) + "/review", { method: "POST", status, data: { decision: "APPROVE", category: "HVAC", priority: "HIGH", expected_version: 1 } });
      await api(actor, ticketPath(staleReview) + "/assign", { method: "POST", status, data: { technician_id: me.id, expected_version: 2 } });
    }
    await state(admin, staleAssign, "SUBMITTED", 1, 0, 1);
    await state(admin, staleReview, "PENDING_ASSIGNMENT", 2, 0, 2);
  });
  await scenario("53-stale-assignment-retains-one-winning-owner", admin.page, async () => {
    await approve(admin.page, staleAssign);
    const box = await dialog(admin.page, "Assign");
    await box.getByRole("option", { name: "Demo Technician", exact: true }).waitFor({ state: "attached" });
    await box.getByLabel("Technician", { exact: false }).selectOption(String(me.id));
    await openTicket(secondAdmin.page, staleAssign);
    const winner = await dialog(secondAdmin.page, "Assign");
    await winner.getByRole("option", { name: other.name, exact: true }).waitFor({ state: "attached" });
    await winner.getByLabel("Technician", { exact: false }).selectOption(String(other.id));
    await submit(secondAdmin.page, winner, "Assign", staleAssign, "assign");
    assert.equal((await submit(admin.page, box, "Assign", staleAssign, "assign", 409)).error.code, "TICKET_VERSION_CONFLICT");
    await admin.page.getByText(/updated by someone else/i).waitFor();
    await admin.page.getByRole("table", { name: "Assignment records" }).getByText(other.name, { exact: true }).waitFor();
    const detail = await state(admin, staleAssign, "ASSIGNED", 3, 1, 3);
    assert.equal(detail.current_assignee.id, other.id);
    assert.equal(detail.timeline.filter((e) => e.type === "TICKET_ASSIGNED").length, 1);
    await shot(admin.page, "assignment-conflict.png");
  });
  await scenario("53-disabled-loaded-candidate-field-error-and-correction", admin.page, async () => {
    await approve(admin.page, disabled);
    const box = await dialog(admin.page, "Assign");
    await box.getByRole("option", { name: other.name, exact: true }).waitFor({ state: "attached" });
    await box.getByLabel("Technician", { exact: false }).selectOption(String(other.id));
    await api(secondAdmin, "/api/admin/users/" + other.id + "/active", { method: "PATCH", data: { active: false } });
    const error = await submit(admin.page, box, "Assign", disabled, "assign", 422);
    assert.equal(error.error.code, "VALIDATION_ERROR"); assert.equal(error.error.field_errors[0].field, "technician_id");
    await box.locator("#assign-technician[aria-invalid=true]").waitFor();
    assert.ok(await box.getByRole("alert").count() >= 1);
    await state(admin, disabled, "PENDING_ASSIGNMENT", 2, 0, 2);
    await shot(admin.page, "disabled-candidate.png");
    await box.getByLabel("Technician", { exact: false }).selectOption(String(me.id));
    await submit(admin.page, box, "Assign", disabled, "assign");
    await state(admin, disabled, "ASSIGNED", 3, 1, 3);
    await api(secondAdmin, "/api/admin/users/" + other.id + "/active", { method: "PATCH", data: { active: true } });
  });
  await scenario("53-no-active-candidates-disables-confirmation", admin.page, async () => {
    await approve(admin.page, noCandidates, "LOW");
    const candidates = [];
    let cursor;
    do {
      const page = await api(admin, "/api/admin/users?role=TECHNICIAN&active=true&limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
      candidates.push(...page.items); cursor = page.next_cursor;
    } while (cursor);
    try {
      for (const candidate of candidates) await api(admin, "/api/admin/users/" + candidate.id + "/active", { method: "PATCH", data: { active: false } });
      await admin.page.reload();
      await admin.page.getByRole("heading", { name: noCandidates.title, exact: true }).waitFor();
      const box = await dialog(admin.page, "Assign");
      await box.getByText(/No active technicians are available/).waitFor();
      assert.equal(await box.getByRole("button", { name: "Assign", exact: true }).isDisabled(), true);
      await state(admin, noCandidates, "PENDING_ASSIGNMENT", 2, 0, 2);
      await shot(admin.page, "no-active-technicians.png");
      await box.getByRole("button", { name: "Cancel", exact: true }).click();
    } finally {
      for (const candidate of candidates) await api(admin, "/api/admin/users/" + candidate.id + "/active", { method: "PATCH", data: { active: true } });
    }
  });
  await scenario("53-priority-filter-and-queue-switch-reset", admin.page, async () => {
    await admin.page.goto("/workbench?queue=assignment");
    await admin.page.getByLabel("Priority", { exact: true }).selectOption("HIGH");
    const filtered = admin.page.waitForResponse((r) => r.url().includes("/api/tickets?") && new URL(r.url()).searchParams.get("priority") === "HIGH");
    await admin.page.getByRole("button", { name: "Apply filters" }).click();
    const list = await (await filtered).json();
    assert.ok(list.items.length > 0 && list.items.every((t) => t.status === "PENDING_ASSIGNMENT" && t.priority === "HIGH"));
    await admin.page.getByRole("link", { name: staleReview.title, exact: true }).waitFor();
    await admin.page.getByRole("link", { name: noCandidates.title, exact: true }).waitFor({ state: "hidden" });
    await admin.page.getByRole("link", { name: "Review queue", exact: true }).click();
    assert.equal(await admin.page.getByLabel("Priority", { exact: true }).inputValue(), "");
    await admin.page.getByRole("link", { name: "Pending assignment", exact: true }).click();
    await admin.page.getByRole("link", { name: noCandidates.title, exact: true }).waitFor();
  });
  for (const [label, ticket] of Object.entries(result.tickets)) {
    const detail = await api(admin, ticketPath(ticket));
    result.tickets[label] = {
      ...ticket, status: detail.status, version: detail.version,
      current_assignee_id: detail.current_assignee?.id ?? null,
      assignments: detail.assignments.map((a) => ({ technician_id: a.technician.id, ended_at: a.ended_at })),
      events: detail.timeline.filter((e) => e.kind === "EVENT").map((e) => e.type),
    };
  }
  assert.deepEqual(result.page_errors, []);
  assert.ok(result.network.length > 0);
  await scenario("53-mobile-queue-has-no-document-overflow", admin.page, async () => {
    await admin.page.setViewportSize({ width: 390, height: 844 });
    await shot(admin.page, "mobile-pending-assignment.png");
    result.mobile_layout = await admin.page.evaluate(() => ({
      viewport_width: window.innerWidth, document_width: document.documentElement.scrollWidth,
      overflowing_elements: [...document.querySelectorAll("body *")].filter((element) =>
        element.getBoundingClientRect().right > window.innerWidth
      ).map((element) => ({
        tag: element.tagName, class: element.className,
        right: element.getBoundingClientRect().right,
      })).slice(0, 20),
    }));
    assert.equal(result.mobile_layout.document_width <= result.mobile_layout.viewport_width, true);
  });
  result.result = "PASS";
} catch (error) {
  result.result = "FAIL"; result.error = error.message; result.error_stack = error.stack;
  if (currentPage) await shot(currentPage, "failure.png").catch(() => {});
  process.exitCode = 1;
} finally {
  result.finished_at = new Date().toISOString();
  await writeFile(resolve(output, "browser-results.json"), JSON.stringify(result, null, 2) + "\n");
  await browser.close();
}
