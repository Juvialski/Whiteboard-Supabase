// Read-only live acceptance checks. Requires QA_PLAYWRIGHT_MODULE pointing to
// an isolated Playwright install. Never opens an installed browser or profile.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE);
const out = path.resolve('artifacts/qa-1');
fs.mkdirSync(out, { recursive: true });
const origin = 'https://whiteboard-8y56.onrender.com';
const report = { timestamp: new Date().toISOString(), browser: {}, http: [], views: [] };
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function publicConfig(s) {
  const url = s.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0];
  const key = s.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0] ||
    s.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)?.find(k => {
      try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url')).role === 'anon'; } catch { return false; }
    });
  return { url, key };
}
(async () => {
  const start = Date.now();
  const res = await fetch(origin);
  const html = await res.text();
  report.http.push({ path: '/', status: res.status, ms: Date.now() - start });
  const assetPaths = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m => m[1]))];
  let js = '';
  for (const p of assetPaths) {
    const r = await fetch(origin + p); const bytes = Buffer.from(await r.arrayBuffer());
    report.http.push({ path: p, status: r.status, bytes: bytes.length, sha256: hash(bytes), contentType: r.headers.get('content-type') });
    if (p.endsWith('.js')) js = bytes.toString();
  }
  for (const p of ['/healthz', '/api/qa1-nonexistent']) {
    const r = await fetch(origin + p); report.http.push({ path: p, status: r.status, body: (await r.text()).slice(0, 100) });
  }
  const { url, key } = publicConfig(js);
  report.deployedFeatureMarkers = Object.fromEntries(['transition_board_timer','Cover Answer','Restore board archive','Clear Active Page Annotations'].map(m => [m, js.includes(m)]));
  if (url && key) {
    const headers = { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}) };
    const schema = await fetch(url + '/rest/v1/', { headers: { ...headers, Accept: 'application/openapi+json' } });
    const body = await schema.json();
    report.apiSchema = { status: schema.status, rpcPaths: Object.keys(body.paths || {}).filter(p => p.startsWith('/rpc/')) };
    // Getter only, with a fabricated nonexistent ID; no board contents requested.
    const r = await fetch(url + '/rest/v1/rpc/get_board_timer', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_board_id: 'QA1-NONEXISTENT-20261009' }) });
    const response = await r.json();
    report.timerGetterUnsigned = { status: r.status, code: response.code, message: response.message };
    const settings = await fetch(url + '/auth/v1/settings', { headers });
    const data = await settings.json();
    report.auth = { status: settings.status, googleEnabled: data.external?.google, anonymousEnabled: data.external?.anonymous_users };
  }
  const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath(), args: ['--mute-audio'] });
  report.browser = { version: browser.version(), headless: true, freshContexts: true, audio: 'muted; no audible verification' };
  try {
    for (const [name, width, height] of [['desktop',1440,900],['mobile',390,844],['tablet',768,1024]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage(); const errors = [], failures = [], requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('response', r => { const u = new URL(r.url()); requests.push({ origin: u.origin, path: u.pathname, status: r.status() }); if (r.status() >= 400) failures.push({ path: u.pathname, status: r.status() }); });
      page.on('requestfailed', r => failures.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }));
      const before = Date.now(); await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
      await page.screenshot({ path: path.join(out, `live-${name}.png`), fullPage: true });
      const view = await page.evaluate(() => ({ text: document.body.innerText, overflow: document.documentElement.scrollWidth > innerWidth,
        storageKeys: Object.keys(localStorage), buttons: [...document.querySelectorAll('button')].map(b => ({ text:b.innerText, title:b.title })),
        navigation: performance.getEntriesByType('navigation')[0]?.toJSON() }));
      report.views.push({ name, width, height, loadMs:Date.now()-before, ...view, errors, failures, requests });
      if (name === 'desktop') {
        await page.reload({ waitUntil:'networkidle' }); report.reloadErrors = [...errors];
        await context.setOffline(true); report.offlineBodyRetained = (await page.locator('body').innerText()).length > 0;
        await context.setOffline(false); await page.reload({ waitUntil:'networkidle' });
        // A fabricated board-ID link must prompt for sign-in; do not redeem invitations.
        await page.goto(origin + '/?board=QA1-NONEXISTENT-20261009', { waitUntil:'networkidle' });
        report.boardIdGate = (await page.locator('body').innerText()).slice(0, 1500);
      }
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out,'public-results.json'),JSON.stringify(report,null,2)); }
  console.log(JSON.stringify({ http:report.http, browser:report.browser, views:report.views.map(v => ({ name:v.name,text:v.text.slice(0,1200),overflow:v.overflow,errors:v.errors,failures:v.failures })), apiSchema:report.apiSchema, timerGetterUnsigned:report.timerGetterUnsigned, auth:report.auth, boardIdGate:report.boardIdGate },null,2));
})().catch(e => { fs.writeFileSync(path.join(out,'public-results.json'),JSON.stringify({...report, fatal:e.message},null,2)); console.error(e); process.exitCode=1; });
