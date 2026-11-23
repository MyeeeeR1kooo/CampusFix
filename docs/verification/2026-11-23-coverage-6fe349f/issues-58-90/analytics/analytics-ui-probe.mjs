import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const e=process.env;
const {chromium}=await import(pathToFileURL(e.PLAYWRIGHT_MODULE));
const browser=await chromium.launch({headless:true,executablePath:e.CHROMIUM_EXECUTABLE});
const context=await browser.newContext({baseURL:e.BASE_URL,viewport:{width:1440,height:1000}});
const page=await context.newPage();
const report={issue:58,source_commit:e.SOURCE_COMMIT,started_at:new Date().toISOString(),checks:[],injection:'Only this browser intercepted analytics GET: first delayed actual request, then aborted requests to simulate transport failure. Retry restored real API. No synthetic responses; database unchanged.'};
try{
  await page.goto('/login');
  await page.locator('#login-email').fill('admin@example.invalid');
  await page.locator('#login-password').fill(e.SEED_ADMIN_PASSWORD);
  await page.getByRole('button',{name:'Log in',exact:true}).click();
  await page.waitForURL(u=>u.pathname!=='/login');
  let mode='delay';
  await page.route('**/api/admin/analytics',async route=>{
    if(mode==='abort')return route.abort('failed');
    if(mode==='delay')await new Promise(r=>setTimeout(r,1200));
    return route.continue();
  });
  await page.goto('/analytics');
  await page.getByRole('status').filter({hasText:'Loading statistics'}).waitFor();
  report.checks.push({name:'Loading text while a real request is delayed',status:'PASS'});
  await page.locator('.stat-card-backlog .stat-value').waitFor();
  report.distribution_idrefs=await page.locator('.distribution-grid section').evaluateAll(sections=>sections.map(s=>({heading:s.querySelector('h2').textContent,heading_id:s.querySelector('h2').id,aria_labelledby:s.getAttribute('aria-labelledby'),referenced_ids:s.getAttribute('aria-labelledby').split(/\s+/).map(id=>({id,exists:document.getElementById(id)!==null}))})));
  report.ax_snapshot=await page.locator('.distribution-grid').ariaSnapshot();
  for(const item of report.distribution_idrefs)assert.ok(item.referenced_ids.every(r=>!r.exists));
  report.observation='The three distribution headings have spaces in their id; aria-labelledby is parsed as separate IDREF tokens, none exists. Headings and numeric content remain visible, but the sections lack the intended accessible names.';
  mode='abort';
  await page.reload();
  await page.getByRole('button',{name:'Retry',exact:true}).waitFor({timeout:20000});
  report.checks.push({name:'Visible error and Retry after injected transport failure',status:'PASS'});
  await page.screenshot({path:resolve(e.RESULT_DIR,'03-analytics-error-injected.png'),fullPage:true});
  mode='real';
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/analytics'&&r.status()===200);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await response;
  await page.locator('.stat-card-backlog .stat-value').waitFor();
  assert.equal(await page.locator('.stat-card-backlog .stat-value').innerText(),'9');
  report.checks.push({name:'Retry restores real API and populated statistics',status:'PASS'});
  report.status='PASS_WITH_ACCESSIBILITY_OBSERVATION';
}catch(error){report.status='FAIL';report.error=error.message;process.exitCode=1;}
finally{await browser.close();report.finished_at=new Date().toISOString();await writeFile(resolve(e.RESULT_DIR,'ui-probe.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks,observation:report.observation}));}
