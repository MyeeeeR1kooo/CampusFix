/** Real localhost production UI smoke for C7. No Mock routing or synthetic API success. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const base = (process.env.BASE_URL ?? 'http://127.0.0.1:41823').replace(/\/$/, '');
assert.ok(['http:', 'https:'].includes(new URL(base).protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'HTTP(S) localhost test target required');
assert.ok(process.env.RESULT_DIR, 'Set RESULT_DIR to the evidence output directory');
const output = resolve(process.env.RESULT_DIR);
const repo = resolve(process.env.REPO_DIR ?? process.cwd());
const passwords = Object.fromEntries(['REPORTER', 'ADMIN', 'TECHNICIAN'].map(role => [role, process.env[`SEED_${role}_PASSWORD`]]));
assert.ok(Object.values(passwords).every(Boolean), 'Set three SEED_*_PASSWORD variables');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const photo = await readFile(resolve(repo, 'tests/e2e/fixtures/photo.png'));
await mkdir(output, { recursive: true });
const clean = text => {
  let s = String(text);
  for (const v of Object.values(passwords)) s = s.replaceAll(v, '[REDACTED]');
  return s.replaceAll(repo, '[repository]').replaceAll(output, '[evidence]').replace(/file:\/\/\/Users\/[^\s)]+/g, '[local-file]');
};
const results = { started_at: new Date().toISOString(), source_commit: process.env.SOURCE_COMMIT ?? process.env.GIT_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), base_url: base, scenario: 'production UI three-role lifecycle including rework and same-payload confirm replay', scenarios: [], transitions: [], network: [], page_errors: [], blocked_external_requests: [], screenshots: [], assertions: {} };
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
results.browser_version = browser.version();
let current;
let ticket;
let firstConfirmPayload;
const actors = {};
async function api(actor, path, payload) {
  assert.ok(path.startsWith('/api/'));
  const value = await actor.page.evaluate(async ({ path, payload }) => {
    const r = await fetch(path, payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { status: r.status, body: await r.json() };
  }, { path, payload });
  assert.equal(value.status, 200, `API ${path}: HTTP ${value.status}`);
  if (payload !== undefined) results.transitions.push(project('confirm_same_payload_replay', actor.role, value.status, value.body));
  return value.body;
}
function project(action, role, http_status, body) {
  return { action, role, http_status, response: { id: body.id, code: body.code, status: body.status, version: body.version, created_at: body.created_at, updated_at: body.updated_at, closed_at: body.closed_at, current_assignee_id: body.current_assignee?.id ?? null } };
}
async function shot(actor, name) {
  current = actor;
  await actor.page.screenshot({ path: resolve(output, name), fullPage: true });
  results.screenshots.push({ role: actor.role, file: name, viewport: actor.page.viewportSize() });
}
async function scenario(name, action) {
  const started = Date.now();
  try { await action(); results.scenarios.push({ name, result: 'PASS', duration_ms: Date.now() - started }); console.log('PASS ' + name); }
  catch (e) { results.scenarios.push({ name, result: 'FAIL', error: clean(e.message) }); throw e; }
}
async function login(role) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === new URL(base).origin || ['blob:', 'data:'].includes(u.protocol)) await route.continue();
    else { results.blocked_external_requests.push(u.origin); await route.abort(); }
  });
  const page = await context.newPage();
  const actor = { role, page, context }; current = actor;
  page.on('pageerror', e => results.page_errors.push({ role, message: clean(e.message) }));
  page.on('response', r => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    results.network.push({ role, method: r.request().method(), path: u.pathname, status: r.status() });
  });
  await page.goto('/login');
  await page.locator('#login-email').fill(role.toLowerCase() + '@example.invalid');
  await page.locator('#login-password').fill(passwords[role]);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  assert.equal((await response).status(), 200, role + ' UI login');
  await page.waitForURL(u => u.pathname !== '/login');
  actor.user = await api(actor, '/api/me'); assert.equal(actor.user.role, role);
  return actor;
}
const path = () => `/api/tickets/${ticket.id}`;
async function open(actor) { current = actor; await actor.page.goto(`/tickets/${ticket.id}`); await actor.page.getByRole('heading', { name: ticket.title, exact: true }).waitFor(); }
async function dialog(actor, label) { current = actor; await actor.page.getByRole('button', { name: label, exact: true }).click(); const d = actor.page.getByRole('dialog'); await d.waitFor(); return d; }
async function submit(actor, box, label, action, status) {
  const wait = actor.page.waitForResponse(r => new URL(r.url()).pathname === path() + '/' + action && r.request().method() === 'POST');
  await box.getByRole('button', { name: label, exact: true }).click();
  const r = await wait;
  assert.equal(r.status(), 200, `${action}: HTTP ${r.status()}`);
  if (action === 'confirm') firstConfirmPayload = r.request().postDataJSON();
  const body = await r.json(); assert.equal(body.status, status);
  results.transitions.push(project(action, actor.role, r.status(), body));
  await box.waitFor({ state: 'hidden' });
  const labels = { PENDING_ASSIGNMENT: 'Pending Assignment', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', PENDING_CONFIRMATION: 'Pending Confirmation', CLOSED: 'Closed' };
  await actor.page.getByRole('region', { name: 'Ticket status and responsibility' }).getByText(labels[status], { exact: true }).waitFor();
  return body;
}
async function photoVisible(actor, group, name) {
  const img = actor.page.getByRole('list', { name: group, exact: true }).getByRole('img').filter({ visible: true });
  await img.first().scrollIntoViewIfNeeded();
  await actor.page.waitForFunction(({ group, name }) => Array.from(document.querySelectorAll(`ul[aria-label="${group}"] img`)).some(el => el.alt.includes(name) && el.complete && el.naturalWidth > 0), { group, name });
}
try {
  await scenario('three separate real browser role logins', async () => {
    for (const role of ['REPORTER', 'ADMIN', 'TECHNICIAN']) actors[role] = await login(role);
    assert.equal(new URL(actors.REPORTER.page.url()).pathname, '/reports');
    assert.equal(new URL(actors.ADMIN.page.url()).pathname, '/workbench');
    assert.equal(new URL(actors.TECHNICIAN.page.url()).pathname, '/assignments');
    await actors.TECHNICIAN.page.getByRole('heading', { name: 'My assignments', exact: true }).waitFor();
    await shot(actors.TECHNICIAN, '01-technician-workbench.png');
  });
  const reporter = actors.REPORTER, admin = actors.ADMIN, technician = actors.TECHNICIAN;
  await scenario('reporter creates ticket with report photo through UI', async () => {
    const location = (await api(reporter, '/api/locations?limit=100')).items[0]; assert.ok(location);
    current = reporter; await reporter.page.goto('/reports/new');
    await reporter.page.locator('#report-title').fill('C7 synthetic repair lifecycle ' + Date.now());
    await reporter.page.locator('#report-category').selectOption('FURNITURE');
    await reporter.page.locator('#report-description').fill('Synthetic campus furniture repair used only for isolated acceptance testing.');
    await reporter.page.locator('#report-building').selectOption(location.building);
    await reporter.page.locator('#report-floor').selectOption(location.floor);
    await reporter.page.locator('#report-room').selectOption(String(location.id));
    await reporter.page.getByLabel('Photos', { exact: false }).setInputFiles({ name: 'c7-report.png', mimeType: 'image/png', buffer: photo });
    await shot(reporter, '02-reporter-create.png');
    const pending = reporter.page.waitForResponse(r => new URL(r.url()).pathname === '/api/tickets' && r.request().method() === 'POST');
    await reporter.page.getByRole('button', { name: 'Submit report', exact: true }).click();
    const response = await pending; assert.equal(response.status(), 201); ticket = await response.json();
    assert.equal(ticket.status, 'SUBMITTED'); results.transitions.push(project('submit', reporter.role, response.status(), ticket)); await reporter.page.waitForURL(`**/tickets/${ticket.id}`);
    const detail = await api(reporter, path()); assert.equal(detail.report_photos.length, 1);
    results.ticket = { id: ticket.id, code: ticket.code, title: ticket.title };
    await photoVisible(reporter, 'Report photos', 'c7-report.png');
    await shot(reporter, '03-reporter-submitted.png');
  });
  await scenario('administrator reviews then assigns via workbench', async () => {
    current = admin; await admin.page.goto('/workbench');
    await admin.page.getByRole('table', { name: 'Review queue', exact: true }).getByRole('link', { name: ticket.title, exact: true }).click();
    let box = await dialog(admin, 'Review');
    await box.getByLabel('Category', { exact: false }).selectOption('FURNITURE');
    await box.getByLabel('Priority', { exact: false }).selectOption('HIGH');
    await submit(admin, box, 'Approve', 'review', 'PENDING_ASSIGNMENT');
    box = await dialog(admin, 'Assign');
    await box.getByLabel('Technician', { exact: false }).selectOption(String(technician.user.id));
    await submit(admin, box, 'Assign', 'assign', 'ASSIGNED');
    await shot(admin, '04-admin-assigned.png');
  });
  await scenario('technician sees assigned ticket and starts through UI', async () => {
    current = technician; await technician.page.goto('/assignments');
    await technician.page.getByRole('table', { name: 'My assigned tickets', exact: true }).getByRole('link', { name: ticket.title, exact: true }).waitFor();
    const list = await api(technician, '/api/tickets?limit=100'); assert.ok(list.items.some(t => t.id === ticket.id));
    assert.ok(list.items.every(t => t.current_assignee?.id === technician.user.id));
    await shot(technician, '05-technician-assigned-list.png');
    await technician.page.getByRole('link', { name: ticket.title, exact: true }).click();
    const box = await dialog(technician, 'Start work');
    await box.getByLabel('Opening note').fill('Inspected synthetic furniture fixture.');
    await submit(technician, box, 'Start work', 'start', 'IN_PROGRESS');
  });
  await scenario('technician submits result with photo through mobile UI', async () => {
    await technician.page.setViewportSize({ width: 390, height: 844 });
    const box = await dialog(technician, 'Submit result');
    await box.getByRole('button', { name: 'Submit result', exact: true }).click();
    await box.getByText('Describe the work you carried out.', { exact: true }).waitFor();
    await box.getByLabel('Resolution note', { exact: false }).fill('First synthetic repair: tightened fixture.');
    await box.getByLabel('Photos', { exact: false }).setInputFiles({ name: 'c7-result-first.png', mimeType: 'image/png', buffer: photo });
    const dims = await box.evaluate(el => ({ width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth, viewport: window.innerWidth }));
    assert.ok(dims.width <= dims.viewport && dims.scrollWidth <= dims.width + 1, 'Mobile dialog overflow');
    results.assertions.mobile_dialog = dims; await shot(technician, '06-technician-mobile-result-photo.png');
    await submit(technician, box, 'Submit result', 'resolve', 'PENDING_CONFIRMATION');
    const detail = await api(technician, path()); assert.equal(detail.resolution_photos.length, 1);
  });
  await scenario('reporter requests rework with required reason', async () => {
    await open(reporter); await photoVisible(reporter, 'Resolution photos', 'c7-result-first.png');
    const box = await dialog(reporter, 'Request rework');
    await box.getByRole('button', { name: 'Request rework', exact: true }).click();
    await box.getByText('Enter a reason so the technician knows what to fix.', { exact: true }).waitFor();
    await box.getByLabel('What still needs fixing?', { exact: false }).fill('Synthetic fixture still needs final alignment.');
    await shot(reporter, '07-reporter-rework.png');
    await submit(reporter, box, 'Request rework', 'rework', 'IN_PROGRESS');
    assert.equal((await api(reporter, path())).current_assignee.id, technician.user.id);
  });
  await scenario('technician resubmits reworked result and second photo', async () => {
    await technician.page.setViewportSize({ width: 1440, height: 1000 }); await open(technician);
    const box = await dialog(technician, 'Submit result');
    await box.getByLabel('Resolution note', { exact: false }).fill('Second synthetic repair: aligned fixture and verified stability.');
    await box.getByLabel('Photos', { exact: false }).setInputFiles({ name: 'c7-result-second.png', mimeType: 'image/png', buffer: photo });
    await submit(technician, box, 'Submit result', 'resolve', 'PENDING_CONFIRMATION');
    assert.equal((await api(technician, path())).resolution_photos.length, 2);
    await photoVisible(technician, 'Resolution photos', 'c7-result-second.png'); await shot(technician, '08-technician-resubmitted.png');
  });
  await scenario('reporter confirms via UI; exact same payload replay is idempotent', async () => {
    await open(reporter); const before = await api(reporter, path());
    const box = await dialog(reporter, 'Confirm completion');
    await submit(reporter, box, 'Confirm completion', 'confirm', 'CLOSED');
    assert.equal(firstConfirmPayload.expected_version, before.version); assert.ok(firstConfirmPayload.idempotency_key);
    const first = await api(reporter, path());
    const duplicate = await api(reporter, path() + '/confirm', firstConfirmPayload);
    const final = await api(reporter, path());
    assert.equal(duplicate.status, 'CLOSED'); assert.equal(duplicate.version, first.version); assert.equal(final.version, first.version); assert.equal(final.closed_at, first.closed_at);
    assert.equal(final.timeline.filter(e => e.kind === 'EVENT' && e.type === 'TICKET_CLOSED').length, 1);
    assert.deepEqual(final.timeline, first.timeline);
    assert.deepEqual(final.allowed_actions, []);
    const types = final.timeline.filter(e => e.kind === 'EVENT').map(e => e.type);
    for (const event of ['TICKET_SUBMITTED','TICKET_APPROVED','TICKET_ASSIGNED','WORK_STARTED','REWORK_REQUESTED','TICKET_CLOSED']) assert.equal(types.filter(t => t === event).length, 1);
    assert.equal(types.filter(t => t === 'RESOLUTION_SUBMITTED').length, 2);
    const expectedEvents = ['TICKET_SUBMITTED','TICKET_APPROVED','TICKET_ASSIGNED','WORK_STARTED','RESOLUTION_SUBMITTED','REWORK_REQUESTED','RESOLUTION_SUBMITTED','TICKET_CLOSED'];
    assert.deepEqual(types, expectedEvents);
    results.assertions.event_sequence = { expected: expectedEvents, observed: types, exact_order_match: true };
    results.final_events = final.timeline.filter(e => e.kind === 'EVENT').map(e => ({ id: e.id, type: e.type, created_at: e.created_at }));
    results.final_ticket = { id: final.id, code: final.code, status: final.status, version: final.version, closed_at: final.closed_at, report_photos: final.report_photos.length, resolution_photos: final.resolution_photos.length, event_types: types, assignments: final.assignments.length };
    results.assertions.confirm_replay = { exact_original_payload: true, idempotency_key_present: true, key_redacted: true, response_status: 200, unchanged_version: true, unchanged_closed_at: true, unchanged_timeline: true, ticket_closed_events: 1 };
    await shot(reporter, '09-reporter-closed.png');
  });
  assert.deepEqual(results.page_errors, []); assert.deepEqual(results.blocked_external_requests, []);
  results.result = 'PASS';
} catch (error) {
  results.result = 'FAIL'; results.error = clean(error.stack ?? error.message);
  if (current) { await current.page.locator('input[type="password"]').fill('').catch(() => {}); await shot(current, 'failure.png').catch(() => {}); }
  process.exitCode = 1;
} finally {
  results.finished_at = new Date().toISOString();
  await writeFile(resolve(output, 'c7-browser.json'), clean(JSON.stringify(results, null, 2)) + '\n');
  await browser.close();
}
console.log(JSON.stringify({ result: results.result, scenarios: results.scenarios.length, ticket: results.ticket?.code, evidence: 'c7-browser.json', ...(results.error ? { error: results.error } : {}) }, null, 2));
