/** #90 acceptance against a real, isolated localhost production UI. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const base = (process.env.BASE_URL ?? '').replace(/\/$/, '');
assert.ok(base && ['http:', 'https:'].includes(new URL(base).protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Set BASE_URL to HTTP(S) localhost');
assert.ok(process.env.RESULT_DIR, 'Set RESULT_DIR');
const output = resolve(process.env.RESULT_DIR);
const repo = resolve(process.env.REPO_DIR ?? process.cwd());
const sourceCommit = process.env.SOURCE_COMMIT ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const fixtureId = Number(process.env.FIXTURE_TICKET_ID ?? 1);
assert.ok(Number.isInteger(fixtureId) && fixtureId > 0, 'Set a positive FIXTURE_TICKET_ID');
const passwords = Object.fromEntries(['ADMIN', 'REPORTER', 'TECHNICIAN'].map(role => [role, process.env[`SEED_${role}_PASSWORD`]]));
assert.ok(Object.values(passwords).every(Boolean), 'Set SEED_*_PASSWORD for three synthetic accounts');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
await mkdir(output, { recursive: true });
function redact(value) {
  let s = String(value);
  for (const secret of [...Object.values(passwords), process.env.SECRET_KEY, process.env.DATABASE_URL].filter(Boolean)) s = s.replaceAll(secret, '[REDACTED]');
  return s.replaceAll(repo, '[repository]').replaceAll(output, '[evidence]').replace(/(?:file:\/\/)?\/(?:Users|private|var)\/[^\s)]+/g, '[local-path]');
}
const result = {
  issue: 90, source_commit: sourceCommit, started_at: new Date().toISOString(), base_url: base,
  method: 'Real production UI with real local API/database; no mocked responses',
  scenarios: [], observations: [], screenshots: [], network: [], page_errors: [], external_requests: [],
};
let browser;
let current;
const actors = {};
function userView(user) { return { id: user.id, role: user.role, active: user.active }; }
function ticketView(t) {
  return { id: t.id, code: t.code, status: t.status, version: t.version, reporter_id: t.reporter?.id, current_assignee_id: t.current_assignee?.id ?? null,
    created_at: t.created_at, updated_at: t.updated_at, closed_at: t.closed_at,
    event_ids: (t.timeline ?? []).filter(e => e.kind === 'EVENT').map(e => e.id),
    event_types: (t.timeline ?? []).filter(e => e.kind === 'EVENT').map(e => e.type), assignments: t.assignments?.length };
}
function observation(name, actor, status, body, kind = 'user') {
  const response = status >= 400 ? { error_code: body.error?.code } : kind === 'ticket' ? ticketView(body) : kind === 'list' ? { items: body.items.map(userView), has_next_cursor: Boolean(body.next_cursor) } : userView(body);
  result.observations.push({ name, role: actor.role, http_status: status, response });
}
async function api(actor, path, { method = 'GET', body, status = 200, name = path, kind = 'user' } = {}) {
  assert.ok(path.startsWith('/api/'));
  const response = await actor.page.evaluate(async ({ path, method, body }) => {
    const r = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: r.status, body: await r.json() };
  }, { path, method, body });
  observation(name, actor, response.status, response.body, kind);
  assert.equal(response.status, status, `${name}: expected ${status}, received ${response.status}`);
  if (status === 401) assert.equal(response.body.error.code, 'UNAUTHORIZED');
  if (status === 403) assert.equal(response.body.error.code, 'FORBIDDEN');
  return response.body;
}
async function shot(actor, name) {
  current = actor;
  const passwordFields = actor.page.locator('input[type="password"]');
  if (await passwordFields.count()) await passwordFields.fill('');
  await actor.page.screenshot({ path: resolve(output, name), fullPage: true });
  result.screenshots.push({ file: name, role: actor.role, viewport: actor.page.viewportSize() });
}
async function scenario(name, run) {
  const started = Date.now();
  try { await run(); result.scenarios.push({ name, result: 'PASS', duration_ms: Date.now() - started }); console.log('PASS ' + name); }
  catch (e) { result.scenarios.push({ name, result: 'FAIL', error: redact(e.message) }); throw e; }
}
async function newActor(role) {
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  context.setDefaultTimeout(15000);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(base).origin || ['blob:', 'data:'].includes(url.protocol)) await route.continue();
    else { result.external_requests.push(url.origin); await route.abort(); }
  });
  const page = await context.newPage();
  const actor = { role, context, page }; current = actor;
  page.on('pageerror', e => result.page_errors.push({ role, message: redact(e.message) }));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) result.network.push({ role, method: response.request().method(), path: url.pathname, http_status: response.status() });
  });
  return actor;
}
async function login(role, { status = 200, name = `${role.toLowerCase()}_login` } = {}) {
  const actor = await newActor(role);
  await actor.page.goto('/login');
  await actor.page.locator('#login-email').fill(role.toLowerCase() + '@example.invalid');
  await actor.page.locator('#login-password').fill(passwords[role]);
  const pending = actor.page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await actor.page.getByRole('button', { name: 'Log in', exact: true }).click();
  const response = await pending; const body = await response.json();
  observation(name, actor, response.status(), body);
  assert.equal(response.status(), status, name);
  if (status === 200) {
    await actor.page.waitForURL(u => u.pathname !== '/login');
    actor.user = await api(actor, '/api/me', { name: name + '_me' });
    assert.equal(actor.user.role, role); assert.equal(actor.user.active, true);
  } else {
    assert.equal(body.error.code, 'UNAUTHORIZED');
    await actor.page.getByText('Email or password is not correct.', { exact: true }).waitFor();
    assert.equal(new URL(actor.page.url()).pathname, '/login');
    await actor.page.locator('#login-password').fill('');
  }
  return actor;
}
function table(actor) { return actor.page.getByRole('table', { name: 'Managed accounts', exact: true }); }
function row(actor, role) { return table(actor).getByRole('row').filter({ hasText: role.toLowerCase() + '@example.invalid' }); }
async function filter(admin, role, active, name) {
  await admin.page.locator('#account-role').selectOption(role);
  await admin.page.locator('#account-status').selectOption(active);
  const pending = admin.page.waitForResponse(r => {
    const url = new URL(r.url());
    return url.pathname === '/api/admin/users' && (url.searchParams.get('role') ?? '') === role && (url.searchParams.get('active') ?? '') === active;
  });
  await admin.page.getByRole('button', { name: 'Apply filters', exact: true }).click();
  const response = await pending; const body = await response.json();
  observation(name, admin, response.status(), body, 'list'); assert.equal(response.status(), 200);
  assert.ok(body.items.every(u => (!role || u.role === role) && (!active || u.active === (active === 'true'))));
  await admin.page.getByRole('button', { name: 'Apply filters', exact: true }).waitFor({ state: 'visible' });
  if (body.items.length) {
    await table(admin).getByText(body.items[0].email, { exact: true }).waitFor();
    assert.equal(await table(admin).locator('tbody tr').count(), body.items.length);
  } else await table(admin).getByText('No accounts match these filters.', { exact: true }).waitFor();
  return body;
}
async function clearFilters(admin) {
  await admin.page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await row(admin, 'REPORTER').getByText(/^(Active|Inactive)$/).waitFor();
  await row(admin, 'TECHNICIAN').getByText(/^(Active|Inactive)$/).waitFor();
  assert.equal(await admin.page.locator('#account-role').inputValue(), '');
  assert.equal(await admin.page.locator('#account-status').inputValue(), '');
}
async function toggle(admin, target, active) {
  current = admin;
  const pending = admin.page.waitForResponse(r => new URL(r.url()).pathname === `/api/admin/users/${target.user.id}/active` && r.request().method() === 'PATCH');
  if (!active) {
    await row(admin, target.role).getByRole('button', { name: 'Disable', exact: true }).click();
    const dialog = admin.page.getByRole('dialog', { name: 'Disable account?', exact: true });
    await dialog.getByText('This account will lose access on its next request. Existing reports remain available to administrators.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Disable account', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  } else await row(admin, target.role).getByRole('button', { name: 'Enable', exact: true }).click();
  const response = await pending; const body = await response.json();
  observation(`${target.role.toLowerCase()}_${active ? 'enable' : 'disable'}_ui`, admin, response.status(), body);
  assert.equal(response.status(), 200); assert.equal(body.id, target.user.id); assert.equal(body.active, active);
  await row(admin, target.role).getByText(active ? 'Active' : 'Inactive', { exact: true }).waitFor();
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  result.browser_version = browser.version();
  let originalTicket;
  await scenario('three real role logins and historical ticket baseline', async () => {
    for (const role of ['ADMIN', 'REPORTER', 'TECHNICIAN']) actors[role] = await login(role);
    originalTicket = await api(actors.ADMIN, `/api/tickets/${fixtureId}`, { name: 'historical_ticket_before', kind: 'ticket' });
    assert.equal(originalTicket.reporter.id, actors.REPORTER.user.id);
    result.historical_ticket_before = ticketView(originalTicket);
  });
  const admin = actors.ADMIN;
  await scenario('Admin managed accounts role/status filters and clear', async () => {
    await admin.page.goto('/admin/users');
    await admin.page.getByRole('heading', { name: 'Account management', exact: true }).waitFor();
    await row(admin, 'REPORTER').getByText('Active', { exact: true }).waitFor();
    await row(admin, 'TECHNICIAN').getByText('Active', { exact: true }).waitFor();
    assert.equal(await table(admin).getByText('admin@example.invalid', { exact: true }).count(), 0);
    const all = await api(admin, '/api/admin/users?limit=100', { name: 'managed_accounts_excludes_admin', kind: 'list' });
    assert.ok(all.items.every(u => ['REPORTER', 'TECHNICIAN'].includes(u.role)));
    assert.ok(!all.items.some(u => u.id === admin.user.id));
    await shot(admin, '01-managed-accounts-active.png');
    const filtered = await filter(admin, 'REPORTER', 'true', 'filter_active_reporters');
    assert.ok(filtered.items.some(u => u.id === actors.REPORTER.user.id));
    await shot(admin, '02-filter-active-reporters.png');
    await filter(admin, 'TECHNICIAN', 'false', 'filter_inactive_technicians_initially_empty');
    await shot(admin, '03-filter-empty-inactive-technicians.png');
    await clearFilters(admin);
  });
  for (const [role, sequence] of [['REPORTER', '04'], ['TECHNICIAN', '07']]) {
    await scenario(`${role} UI disable denies stale session/login; history remains`, async () => {
      const target = actors[role];
      await toggle(admin, target, false);
      await shot(admin, `${sequence}-${role.toLowerCase()}-inactive.png`);
      await api(target, '/api/me', { status: 401, name: `${role.toLowerCase()}_stale_session_denied` });
      const denied = await login(role, { status: 401, name: `${role.toLowerCase()}_disabled_login_denied` });
      await shot(denied, `${Number(sequence) + 1}-${role.toLowerCase()}-disabled-login.png`);
      await denied.context.close();
      const history = await api(admin, `/api/tickets/${fixtureId}`, { name: `historical_ticket_while_${role.toLowerCase()}_disabled`, kind: 'ticket' });
      assert.deepEqual(ticketView(history), ticketView(originalTicket));
      if (role === 'REPORTER') {
        await admin.page.goto(`/tickets/${fixtureId}`);
        await admin.page.getByRole('heading', { name: originalTicket.title, exact: true }).waitFor();
        await shot(admin, '06-admin-history-while-reporter-disabled.png');
        await admin.page.goto('/admin/users');
        await row(admin, role).getByText('Inactive', { exact: true }).waitFor();
      }
      const filtered = await filter(admin, role, 'false', `${role.toLowerCase()}_inactive_filter`);
      assert.ok(filtered.items.some(u => u.id === target.user.id));
      await clearFilters(admin);
    });
    await scenario(`${role} UI re-enable allows fresh login without reviving old session`, async () => {
      const stale = actors[role];
      await toggle(admin, stale, true);
      await api(stale, '/api/me', { status: 401, name: `${role.toLowerCase()}_old_session_still_revoked_after_enable` });
      actors[role] = await login(role, { name: `${role.toLowerCase()}_fresh_login_after_enable` });
      assert.equal(actors[role].user.id, stale.user.id);
      await stale.context.close();
      await shot(actors[role], role === 'REPORTER' ? '09-reporter-restored-login.png' : '10-technician-restored-login.png');
    });
  }
  await scenario('non-Admin account access and Admin self-disable are forbidden', async () => {
    for (const role of ['REPORTER', 'TECHNICIAN']) {
      const actor = actors[role]; current = actor;
      await api(actor, '/api/admin/users', { status: 403, name: `${role.toLowerCase()}_list_forbidden` });
      await api(actor, `/api/admin/users/${actors.REPORTER.user.id}/active`, { method: 'PATCH', body: { active: false }, status: 403, name: `${role.toLowerCase()}_toggle_forbidden` });
      await actor.page.goto('/admin/users');
      await actor.page.getByRole('heading', { name: "You don't have access to this page", exact: true }).waitFor();
      await shot(actor, role === 'REPORTER' ? '11-reporter-forbidden-page.png' : '12-technician-forbidden-page.png');
    }
    await api(admin, `/api/admin/users/${admin.user.id}/active`, { method: 'PATCH', body: { active: false }, status: 403, name: 'admin_self_disable_forbidden' });
    assert.equal((await api(admin, '/api/me', { name: 'admin_still_active_after_denied_self_disable' })).active, true);
    for (const role of ['REPORTER', 'TECHNICIAN']) assert.equal((await api(actors[role], '/api/me', { name: `${role.toLowerCase()}_remains_active_after_forbidden_toggle` })).active, true);
  });
  await scenario('both managed accounts restored and original history unchanged', async () => {
    await admin.page.goto('/admin/users');
    for (const role of ['REPORTER', 'TECHNICIAN']) await row(admin, role).getByText('Active', { exact: true }).waitFor();
    const all = await api(admin, '/api/admin/users?limit=100', { name: 'final_managed_accounts', kind: 'list' });
    for (const role of ['REPORTER', 'TECHNICIAN']) assert.equal(all.items.find(u => u.id === actors[role].user.id)?.active, true);
    const history = await api(admin, `/api/tickets/${fixtureId}`, { name: 'historical_ticket_after', kind: 'ticket' });
    result.historical_ticket_after = ticketView(history);
    assert.deepEqual(result.historical_ticket_after, result.historical_ticket_before);
    result.history_unchanged = true;
    await shot(admin, '13-managed-accounts-restored.png');
  });
  assert.deepEqual(result.page_errors, []); assert.deepEqual(result.external_requests, []);
  result.result = 'PASS'; result.exit_code = 0;
} catch (error) {
  result.result = 'FAIL'; result.exit_code = 1; result.error = redact(error.stack ?? error.message); process.exitCode = 1;
  if (current) await shot(current, 'failure.png').catch(() => {});
} finally {
  result.finished_at = new Date().toISOString();
  await writeFile(resolve(output, 'accounts-browser.json'), redact(JSON.stringify(result, null, 2)) + '\n');
  if (browser) await browser.close();
}
console.log(JSON.stringify({ result: result.result, exit_code: result.exit_code, scenarios: result.scenarios.length, observations: result.observations.length, screenshots: result.screenshots.length, ...(result.error ? { error: result.error } : {}) }, null, 2));
