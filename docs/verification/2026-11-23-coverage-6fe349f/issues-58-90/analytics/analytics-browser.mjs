import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const env = process.env;
const out = env.RESULT_DIR;
await mkdir(out, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: env.REPO_DIR, encoding: 'utf8' }).trim();
assert.equal(commit, env.SOURCE_COMMIT);
const { chromium } = await import(pathToFileURL(env.PLAYWRIGHT_MODULE));
const report = { issue: 58, source_commit: commit, started_at: new Date().toISOString(), environment: 'isolated localhost, real FastAPI and PostgreSQL, synthetic data', frontend_mocking: false, checks: [], network: [], screenshots: [], page_errors: [] };
const statusLabels = { SUBMITTED:'Submitted', PENDING_ASSIGNMENT:'Pending Assignment', ASSIGNED:'Assigned', IN_PROGRESS:'In Progress', PENDING_CONFIRMATION:'Pending Confirmation', CLOSED:'Closed', REJECTED:'Rejected', CANCELLED:'Cancelled' };
const categoryLabels = { LIGHTING_ELECTRICAL:'Lighting & Electrical', DOORS_WINDOWS_LOCKS:'Doors, Windows & Locks', FURNITURE:'Furniture', HVAC:'HVAC', WATER_SANITARY:'Water & Sanitary', OTHER_FACILITY:'Other Facility' };
let browser;
async function check(name, fn) {
  try { const details = await fn(); report.checks.push({ name, status:'PASS', ...(details === undefined ? {} : {details}) }); }
  catch (error) { report.checks.push({name,status:'FAIL',error:String(error.message).replaceAll(env.REPO_DIR,'<checkout>').replaceAll(out,'<evidence>')}); throw error; }
}
async function context(role) {
  const ctx = await browser.newContext({baseURL:env.BASE_URL,viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'});
  await ctx.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(env.BASE_URL).origin || ['data:','blob:'].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',e => report.page_errors.push({role,error:e.message}));
  page.on('response',r => { const path = new URL(r.url()).pathname; if(path.startsWith('/api/')) report.network.push({role,method:r.request().method(),path,status:r.status()}); });
  return {ctx,page};
}
async function login(page,role) {
  await page.goto('/login');
  await page.locator('#login-email').fill(`${role.toLowerCase()}@example.invalid`);
  await page.locator('#login-password').fill(env[`SEED_${role}_PASSWORD`]);
  const response = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/login'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  assert.equal((await response).status(),200);
  await page.waitForURL(u=>u.pathname!=='/login');
}
async function api(page) {
  return page.evaluate(async()=>{const r=await fetch('/api/admin/analytics',{credentials:'same-origin'}); return {status:r.status,body:await r.json()};});
}
async function loadAnalytics(page) {
  const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/analytics'&&r.request().method()==='GET');
  await page.goto('/analytics');
  const response=await pending;
  assert.equal(response.status(),200);
  await page.locator('.stat-card-backlog .stat-value').waitFor();
  return await response.json();
}
async function assertUI(page, data, duration) {
  assert.equal(await page.locator('.stat-card-backlog .stat-value').innerText(),String(data.backlog_count));
  assert.equal(await page.locator('.stat-card-duration .stat-value').innerText(),duration);
  for(const [title,items,key,labels] of [['By status',data.by_status,'status',statusLabels],['By category',data.by_category,'category',categoryLabels],['By building',data.by_building,'building',null]]) {
    const section=page.locator('section.card').filter({has:page.getByRole('heading',{name:title,exact:true})});
    await section.waitFor();
    const rows=await section.locator('.distribution-row').evaluateAll(rows=>rows.map(row=>({label:row.querySelector('.distribution-label').textContent,count:Number(row.querySelector('.distribution-count').textContent)})));
    assert.deepEqual(rows,items.map(item=>({label:labels?labels[item[key]]:item[key],count:item.count})));
    if(!items.length) assert.equal(await section.getByRole('status').innerText(),'No data yet.');
  }
  const trend=await page.locator('.trend-table tbody tr').evaluateAll(rows=>rows.map(row=>({date:row.querySelector('th').textContent,created_count:Number(row.querySelectorAll('td')[0].textContent),closed_count:Number(row.querySelectorAll('td')[1].textContent)})));
  assert.deepEqual(trend,data.daily_trend);
  assert.equal(trend.length,30);
  assert.equal(await page.locator('.stat-card-duration .stat-note').innerText(),'From creation to closure, including confirmation');
}
async function screenshot(page,name) { await page.screenshot({path:resolve(out,name),fullPage:true}); report.screenshots.push(name); }
try {
  browser=await chromium.launch({headless:true,executablePath:env.CHROMIUM_EXECUTABLE});
  const guest=await context('UNAUTHENTICATED');
  await guest.page.goto('/login');
  await check('Unauthenticated analytics denied with HTTP 401',async()=>{const r=await api(guest.page);assert.equal(r.status,401);return r;});
  await guest.ctx.close();
  const admin=await context('ADMIN');
  await login(admin.page,'ADMIN');
  await check('Empty PostgreSQL database: six real API metrics and rendered UI',async()=>{
    const data=await loadAnalytics(admin.page);
    assert.equal(data.by_status.length,8); assert.equal(data.by_category.length,6); assert.deepEqual(data.by_building,[]);
    for(const item of [...data.by_status,...data.by_category]) assert.equal(item.count,0);
    assert.equal(data.backlog_count,0);assert.equal(data.average_close_seconds,0);
    assert.equal(data.daily_trend.length,30);
    for(const day of data.daily_trend){assert.equal(day.created_count,0);assert.equal(day.closed_count,0);}
    await assertUI(admin.page,data,'0 sec');
    await screenshot(admin.page,'01-analytics-empty.png');
    report.empty_response=data;
    return {status_count:8,category_count:6,building_count:0,backlog:0,average_close_seconds:0,trend_rows:30};
  });
  execFileSync(env.CF_PYTHON,[fileURLToPath(new URL('./analytics-fixture.py',import.meta.url))],{env,cwd:env.REPO_DIR,stdio:['ignore','pipe','pipe']});
  const oracle=JSON.parse(await readFile(resolve(out,'analytics-db-oracle.json'),'utf8'));
  report.db_oracle='analytics-db-oracle.json';
  await check('Populated PostgreSQL: exact six-metric API equality to independent raw-row oracle and UI',async()=>{
    const data=await loadAnalytics(admin.page);
    assert.deepEqual(data,oracle.expected);
    await assertUI(admin.page,data,'2.3 days');
    await screenshot(admin.page,'02-analytics-populated.png');
    report.populated_response=data;
    return {synthetic_tickets:oracle.fixture_rows.length,backlog:9,average_close_seconds:201600,by_status_rows:8,by_category_rows:6,by_building_rows:3,trend_rows:30};
  });
  await check('Shanghai 30-day window, midnight pairs, old/future exclusion, and full closure time including wait',async()=>{
    assert.equal(oracle.expected.daily_trend[0].date,oracle.window_start);
    assert.equal(oracle.expected.daily_trend.at(-1).date,oracle.today);
    assert.equal(oracle.expected.daily_trend[0].created_count,1);
    assert.equal(oracle.expected.daily_trend.at(-1).created_count,1);
    assert.equal(oracle.expected.daily_trend.at(-2).created_count,1);
    assert.equal(oracle.expected.daily_trend.reduce((n,d)=>n+d.created_count,0),12);
    assert.equal(oracle.expected.daily_trend.reduce((n,d)=>n+d.closed_count,0),2);
    assert.equal(oracle.expected.average_close_seconds,201600);
    assert.notEqual(oracle.expected.average_close_seconds,oracle.checks.processing_only_average_seconds);
    return oracle.checks;
  });
  for(const role of ['REPORTER','TECHNICIAN']) {
    const actor=await context(role); await login(actor.page,role);
    await check(`${role} analytics denied with HTTP 403`,async()=>{const r=await api(actor.page);assert.equal(r.status,403);assert.equal(r.body.error.code,'FORBIDDEN');return r;});
    await actor.ctx.close();
  }
  await check('No browser JavaScript errors',()=>assert.deepEqual(report.page_errors,[]));
  report.status='PASS';
} catch(error) {
  report.status='FAIL';
  report.failure=String(error.message).replaceAll(env.REPO_DIR,'<checkout>').replaceAll(out,'<evidence>');
  process.exitCode=1;
} finally {
  if(browser)await browser.close();
  report.finished_at=new Date().toISOString();
  await writeFile(resolve(out,'browser.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,checks:report.checks.map(({name,status})=>({name,status})),source_commit:commit}));
}
