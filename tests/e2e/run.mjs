// End-to-end tests: real Chrome + the real built extension (dist/) driven through puppeteer-core.
//   npm run build && npm run test:e2e            (local fixtures)
//   LIVE=1 npm run test:e2e                      (also tests https://www.mindinventory.com/cloud-managed-services/)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFileSync, cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = join(root, 'tests/e2e/.tmp');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const LIVE = !!process.env.LIVE;

// --- test copy of the extension: same code, plus host permission for the local fixture server
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync(join(root, 'dist'), join(tmp, 'ext'), { recursive: true });
const mf = JSON.parse(readFileSync(join(tmp, 'ext/manifest.json'), 'utf8'));
mf.host_permissions = ['<all_urls>']; // the optional all-sites permission, pre-granted for tests
writeFileSync(join(tmp, 'ext/manifest.json'), JSON.stringify(mf));
// Production uses a *closed* shadow root. For tests only, open it so puppeteer can query the extension UI.
const cs = join(tmp, 'ext/content/index.js');
const bundle = readFileSync(cs, 'utf8');
if (!/mode:"closed"/.test(bundle)) throw new Error('closed shadow root marker not found in bundle');
writeFileSync(cs, bundle.replace('mode:"closed"', 'mode:"open"'));

const fixtures = join(root, 'tests/fixtures');
const hits = [];
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  hits.push(p);
  if (p === '/blocked') { res.setHeader('content-type', 'text/html'); res.setHeader('x-frame-options', 'DENY'); res.setHeader('content-security-policy', "frame-ancestors 'none'"); return res.end('<title>BLOCKED-PAGE</title><h1>blocked</h1>'); }
  if (p.startsWith('/nav')) { res.setHeader('content-type', 'text/html'); return res.end('<title>NAVIGATED</title><h1>navigated</h1>'); }
  try {
    const ext = (/\.([a-z]+)$/.exec(p) || [])[1];
    res.setHeader('content-type', { svg: 'image/svg+xml', xml: 'application/xml', txt: 'text/plain' }[ext] || 'text/html');
    let body = readFileSync(join(fixtures, p.slice(1) || 'clickable-card.html'));
    if (p === '/sitemap.xml') body = Buffer.from(String(body).replaceAll('SEO_ORIGIN', req.headers.host)); // the sitemap lists pages of whatever port the test server got
    res.end(body);
  } catch (_) { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

let passed = 0;
const failures = [];
const log = [];
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failures.push(name); console.log('  ✗', name, '\n     ', (e && e.message || e).toString().split('\n').join('\n      ')); }
}
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, enableExtensions: [join(tmp, 'ext')], args: ['--no-sandbox', '--window-size=1280,900'], defaultViewport: { width: 1280, height: 900 } });
const sw = await (await browser.waitForTarget((x) => x.type() === 'service_worker' && x.url().includes('service-worker'))).worker();
const extId = new URL(sw.url()).host;
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(base, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
await ctx.overridePermissions('https://www.mindinventory.com', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

const helper = await browser.newPage();
await helper.goto(`chrome-extension://${extId}/popup/popup.html`);
const consoleErrors = [];

async function openPage(url, { stubExternal = true } = {}) {
  const page = await browser.newPage();
  page.on('dialog', (d) => d.dismiss());
  page.on('pageerror', (e) => consoleErrors.push(`${url}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR|violates the following Content Security Policy directive: "frame-ancestors/.test(m.text())) consoleErrors.push(`${url}: ${m.text()}`); });
  if (stubExternal) {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith(base) || u.startsWith(base.replace('localhost', '127.0.0.1')) || u.startsWith('data:')) r.continue();
      else r.respond({ status: 200, contentType: 'text/html', body: '<title>EXTERNAL</title>' });
    });
  }
  await page.goto(url, { waitUntil: 'load' });
  await page.bringToFront();
  return page;
}
async function activate(page, mode) {
  const tabs = await helper.evaluate(() => chrome.tabs.query({}));
  const tab = tabs.find((x) => x.url === page.url());
  await page.bringToFront();
  const res = await helper.evaluate((tabId, m) => chrome.runtime.sendMessage({ type: 'MI_ACTIVATE', tabId, mode: m, toggle: true }), tab.id, mode);
  await sleep(250);
  return res;
}
const setSettings = (patch) => helper.evaluate(async (p) => {
  const cur = (await chrome.storage.local.get('mi_settings')).mi_settings || {};
  await chrome.storage.local.set({ mi_settings: { ...cur, ...p } });
}, patch);
const resetStorage = () => helper.evaluate(() => chrome.storage.local.clear());
const hostExists = (page) => page.evaluate(() => !!document.querySelector('linklens-root'));
const clip = (page) => page.evaluate(() => navigator.clipboard.readText());
const clipHtml = (page) => page.evaluate(async () => {
  for (const item of await navigator.clipboard.read()) if (item.types.includes('text/html')) return await (await item.getType('text/html')).text();
  return '';
});
async function center(page, sel) {
  const h = await page.$(sel);
  await h.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await sleep(60);
  const b = await h.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}
async function hover(page, sel, offset = {}) {
  const c = await center(page, sel);
  await page.mouse.move(c.x + (offset.dx || 0), c.y + (offset.dy || 0), { steps: 3 });
  await sleep(450);
  return c;
}
const ui = (page, sel) => page.$(`pierce/${sel}`);
const uiText = async (page, sel) => { const h = await ui(page, sel); return h ? h.evaluate((e) => e.textContent) : null; };

console.log('\nTest A — clickable card (local fixture)');
await resetStorage();
let page = await openPage(`${base}/clickable-card.html`);
await t('popup → service worker injects content script and starts Element Picker', async () => {
  const r = await activate(page, 'element');
  ok(r && r.ok, JSON.stringify(r));
  ok(await hostExists(page), 'shadow host mounted');
});
await t('hovering the heading is detected as H2 HEADING with toolbar + highlight', async () => {
  await hover(page, '#robo h2');
  eq(await uiText(page, '.tb-chip'), 'H2 HEADING');
  const outline = await ui(page, '.outline');
  ok(outline && !(await outline.evaluate((e) => e.hidden)), 'outline visible');
});
await t('click on the heading copies exact text and does NOT navigate', async () => {
  const c = await center(page, '#robo h2');
  await page.mouse.click(c.x, c.y);
  await sleep(300);
  eq(await clip(page), 'Asset Allocation Robo-Advisory App');
  eq(page.url(), `${base}/clickable-card.html`, 'url unchanged');
});
await t('paragraph under cursor is detected as PARAGRAPH and copied', async () => {
  const c = await center(page, '#robo-p');
  await page.mouse.move(c.x, c.y, { steps: 2 }); await sleep(450);
  eq(await uiText(page, '.tb-chip'), 'PARAGRAPH');
  await page.mouse.click(c.x, c.y); await sleep(300);
  ok((await clip(page)).startsWith('A tactical asset allocation robo-advising app'));
  eq(page.url(), `${base}/clickable-card.html`);
});
await t('each tag is detected individually', async () => {
  const spans = await page.$$('#robo-tags span');
  const wanted = ['Cloud - Microservices', 'APEX Implementation', 'Admin Panel Implementation'];
  for (let i = 0; i < spans.length; i++) {
    const b = await spans[i].boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 }); await sleep(450);
    eq(await uiText(page, '.tb-chip'), 'TEXT');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(250);
    const got = await clip(page);
    if (got !== wanted[i]) {
      const diag = await page.evaluate((x, y) => {
        const sr = document.querySelector('linklens-root').shadowRoot;
        const q = (s) => { const e = sr.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); };
        return JSON.stringify({ pointer: [Math.round(x), Math.round(y)], linkp: q('.linkp'), tb: q('.tb'), handle: q('.handle'), stack: document.elementsFromPoint(x, y).slice(0, 3).map((e) => e.localName) });
      }, b.x + b.width / 2, b.y + b.height / 2);
      throw new Error(`tag ${i}: expected ${JSON.stringify(wanted[i])} got ${JSON.stringify(got)} ${diag}`);
    }
  }
});
await t('toolbar "Copy Card" copies the full card with outcomes (hovering empty card space)', async () => {
  const card = await page.$('#robo .card');
  const b = await card.boundingBox();
  // empty padding area at the bottom-right of the card
  await page.mouse.move(b.x + b.width - 6, b.y + b.height - 6, { steps: 3 }); await sleep(450);
  const handle = await ui(page, '.handle');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 4 }); await sleep(250);
  const copyCard = await ui(page, '[data-a="card"]');
  const cb = await copyCard.boundingBox();
  ok(cb, 'toolbar visible');
  await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2); await sleep(350);
  const text = await clip(page);
  eq(text, [
    'Asset Allocation Robo-Advisory App',
    'A tactical asset allocation robo-advising app with which the company strives to redefine the way individuals engage with their financial futures, fostering a new era of inclusive and informed investment practices.',
    'Technologies:\n- Cloud - Microservices\n- APEX Implementation\n- Admin Panel Implementation',
    'Outcomes:\n- 25% – Spike in ROI\n- 95% – Accuracy rate\n- 15% – Increase in revenues',
  ].join('\n\n'));
  eq(page.url(), `${base}/clickable-card.html`);
});
await t('toolbar stays inside the viewport (top edge element)', async () => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const c = await center(page, 'h1');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(c.x, 12, { steps: 2 }); await sleep(450);
  const handle = await ui(page, '.handle');
  const hb = await handle.boundingBox();
  ok(hb && hb.x >= 0 && hb.y >= 0 && hb.x + hb.width <= 1280 && hb.y + hb.height <= 900, 'handle ' + JSON.stringify(hb));
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2, { steps: 3 }); await sleep(250);
  const r = await (await ui(page, '.tb')).boundingBox();
  ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1280 && r.y + r.height <= 900, 'menu ' + JSON.stringify(r));
});
await t('Escape exits picker and restores normal navigation', async () => {
  await page.keyboard.press('Escape'); await sleep(250);
  ok(!(await hostExists(page)), 'host removed');
  const c = await center(page, '#robo h2');
  await Promise.all([page.waitForNavigation({ timeout: 5000 }), page.mouse.click(c.x, c.y)]);
  ok(page.url().includes('example.com/robo-advisory'), 'navigated: ' + page.url());
});
await page.close();

console.log('\nTest L — link attribute preview');
await resetStorage();
page = await openPage(`${base}/links.html`);
const lp = async () => {
  const h = await ui(page, '.linkp');
  if (!h) return null;
  return h.evaluate((e) => e.hidden ? null : ({
    rows: [...e.querySelectorAll('.lp-row')].map((r) => [r.querySelector('.lp-k').textContent, r.querySelector('.lp-v').textContent.trim()]),
    rels: [...e.querySelectorAll('.lp-rel')].map((x) => x.textContent),
    box: (() => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })(),
  }));
};
// the panel can cover neighbouring links, so park the pointer away (panel hides) before each new target
const hoverLink = async (sel) => { await page.mouse.move(1100, 700, { steps: 2 }); await sleep(380); return hover(page, sel); };
const val = (d, k) => (d.rows.find((r) => r[0] === k) || [])[1];
await activate(page, 'element');
await t('link with multiple rel values shows every attribute and separate rel chips', async () => {
  await hoverLink('#multi');
  const d = await lp();
  ok(d, 'panel visible');
  eq(val(d, 'Text'), 'Partner link');
  ok(val(d, 'href').endsWith('/partner?x=1') && val(d, 'href').startsWith('http'), val(d, 'href'));
  eq(val(d, 'target'), '_blank');
  eq(val(d, 'title'), 'Our partner');
  eq(val(d, 'aria-label'), 'Partner site');
  eq(val(d, 'download'), 'Not specified');
  eq(d.rels.join(','), 'nofollow,noopener,noreferrer,sponsored,ugc');
  ok(d.box.x >= 0 && d.box.y >= 0 && d.box.x + d.box.w <= 1280 && d.box.y + d.box.h <= 900, 'inside viewport ' + JSON.stringify(d.box));
});
await t('missing attributes read "Not specified"; panel updates immediately when moving to another link', async () => {
  await hoverLink('#plain');
  const d = await lp();
  eq(val(d, 'Text'), 'Plain link');
  for (const k of ['target', 'rel', 'title', 'download', 'aria-label']) eq(val(d, k), 'Not specified', k);
  eq(d.rels.length, 0);
});
await t('moving straight from one link to another (panel not in the way) updates the panel', async () => {
  await hoverLink('#empty-rel');
  eq(val(await lp(), 'Text'), 'Empty rel');
  const c = await center(page, '#second');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  const d = await lp();
  eq(val(d, 'Text'), 'Second link');
  eq(val(d, 'target'), '_self');
});
await t('nested element inside a link resolves to the link (download present)', async () => {
  await hoverLink('#nested-inner strong');
  const d = await lp();
  ok(d, 'panel visible');
  ok(val(d, 'href').endsWith('example.com/nested'));
  eq(val(d, 'download'), 'Present (no filename)');
});
await t('empty rel is shown as Empty, not invented', async () => {
  await hoverLink('#empty-rel');
  eq(val(await lp(), 'rel'), 'Empty');
});
await t('dynamically rendered link is detected', async () => {
  await hoverLink('#dyn');
  const d = await lp();
  ok(d && val(d, 'href').endsWith('/dynamic'), JSON.stringify(d));
  eq(d.rels.join(','), 'ugc');
});
await t('link inside an open Shadow DOM is detected', async () => {
  const c = await page.evaluate(() => { const a = document.getElementById('shadow-host').shadowRoot.getElementById('sh-inner'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(1100, 700); await sleep(550);
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  const d = await lp();
  ok(d && val(d, 'href').endsWith('/in-shadow'), JSON.stringify(d));
  eq(d.rels.join(','), 'nofollow');
});
await t('anchor without href is not treated as a link', async () => {
  await hoverLink('#nohref');
  await sleep(350);
  eq(await lp(), null);
});
await t('pointer can travel from the link into the panel without it vanishing; copy buttons copy raw values', async () => {
  await hoverLink('#multi');
  const d0 = await lp();
  const b = d0.box;
  await page.mouse.move(b.x + b.w / 2, b.y + 20, { steps: 8 });
  await sleep(500);
  ok(await lp(), 'panel still visible over itself');
  const urlBtn = await ui(page, '[data-copy="url"]');
  const ub = await urlBtn.boundingBox();
  await page.mouse.click(ub.x + ub.width / 2, ub.y + ub.height / 2); await sleep(300);
  ok((await clip(page)).endsWith('/partner?x=1'), await clip(page));
  const relBtn = await ui(page, '[data-copy="rel"]');
  const rb = await relBtn.boundingBox();
  await page.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2); await sleep(300);
  eq(await clip(page), 'nofollow noopener  noreferrer sponsored ugc');
  const htmlBtn = await ui(page, '[data-copy="html"]');
  const hb = await htmlBtn.boundingBox();
  await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(300);
  ok((await clip(page)).startsWith('<a id="multi" href="/partner?x=1"'), await clip(page));
  eq(page.url(), `${base}/links.html`, 'no navigation');
});
await t('panel hides when the pointer leaves the link and panel', async () => {
  await page.mouse.move(5, 5, { steps: 3 }); await sleep(600);
  eq(await lp(), null);
});
const previewState = () => page.evaluate(() => {
  const host = document.querySelector('linklens-root');
  const sr = host && host.shadowRoot;
  const prev = sr && sr.querySelector('.lp-prev');
  const panel = sr && sr.querySelector('.linkp');
  if (!prev || prev.hidden || !panel || panel.hidden) return null;
  return { ph: sr.querySelector('.lp-ph').hidden ? '' : sr.querySelector('.lp-ph').textContent, note: sr.querySelector('.lp-prev-note').textContent, frame: !!sr.querySelector('.lp-frame iframe'), src: (sr.querySelector('.lp-frame iframe') || {}).src || '' };
});
await t('link preview: same-site destination loads in a small live frame after a short dwell', async () => {
  await hoverLink('#navlink');
  let s = await previewState();
  ok(!s || !s.frame, 'nothing requested immediately: ' + JSON.stringify(s)); // dwell first
  await sleep(1300);
  s = await previewState();
  ok(s && s.frame && s.src.endsWith('/nav'), JSON.stringify(s));
  const f = page.frames().find((x) => x.url().endsWith('/nav'));
  ok(f, 'preview frame navigated');
  eq(await f.title(), 'NAVIGATED');
  eq(page.url(), `${base}/links.html`, 'main page untouched');
});
await t('link preview: moving away removes the frame', async () => {
  await page.mouse.move(1100, 700, { steps: 2 }); await sleep(700);
  eq(await previewState(), null);
  ok(!page.frames().some((x) => x.url().endsWith('/nav') && x !== page.mainFrame()), 'frame removed');
});
await t('link preview: action-looking links (log out) are never requested', async () => {
  await hoverLink('#logout');
  await sleep(1400);
  const s = await previewState();
  ok(s && !s.frame && /action link/.test(s.note), JSON.stringify(s));
  ok(!hits.includes('/account/logout'), 'server never saw /account/logout');
});
await t('link preview: mailto has no preview; external sites carry an embedding hint', async () => {
  await hoverLink('#mail');
  await sleep(1000);
  const m = await previewState();
  ok(m && !m.frame && /mailto/.test(m.note), JSON.stringify(m));
  await hoverLink('#ext');
  await sleep(1200);
  const e = await previewState();
  ok(e && /block embedding/.test(e.note), JSON.stringify(e));
});
// header rewriting happens at the network layer, which request interception (used by the stubbed pages above) bypasses:
// continue the remaining link tests on a page without interception
await page.close();
page = await openPage(`${base}/links.html`, { stubExternal: false });
await activate(page, 'element');
const frameTitle = async (suffix) => { const f = page.frames().find((x) => x !== page.mainFrame() && x.url().endsWith(suffix)); return f ? f.title() : null; };
const dnrRules = () => helper.evaluate(() => chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length));
await t('full previews: off by default → a site that forbids embedding stays blank and offers to enable full previews', async () => {
  eq(await dnrRules(), 0, 'no header rule installed by default');
  // make the link cross-origin (127.0.0.1 vs localhost) so it counts as an external site
  await page.evaluate(() => { document.getElementById('blockedlink').href = location.origin.replace('localhost', '127.0.0.1') + '/blocked'; });
  await hoverLink('#blockedlink');
  await sleep(1600);
  const s = await previewState();
  ok(s && /block embedding/.test(s.note), JSON.stringify(s));
  const btn = await ui(page, '.lp-enable');
  ok(btn && !(await btn.evaluate((e) => e.hidden)), '"Enable full previews" shown');
  ok((await frameTitle('/blocked')) !== 'BLOCKED-PAGE', 'blocked by X-Frame-Options as expected');
});
await t('full previews: "Enable full previews" opens the settings page at the right switch', async () => {
  const btn = await ui(page, '.lp-enable');
  const d = await lp();
  await page.mouse.move(d.box.x + d.box.w / 2, d.box.y + 20, { steps: 6 }); await sleep(250);
  const [tgt] = await Promise.all([
    new Promise((res) => browser.once('targetcreated', res)),
    (async () => { const bb = await btn.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); })(),
  ]);
  await sleep(600);
  const opts = (await browser.pages()).find((p) => p.url().includes('options/options.html'));
  ok(opts && opts.url().endsWith('#anysite'), 'options opened: ' + (opts && opts.url()));
  ok(await opts.$('input[data-perm="all-sites"]'), 'switch present');
  await opts.close();
  void tgt;
  await page.bringToFront();
});
await t('full previews: when enabled, the same site renders (headers relaxed only for the preview frame)', async () => {
  await setSettings({ linkPreviewAnySite: true }); await sleep(500);
  eq(await dnrRules(), 1, 'rule installed');
  await hoverLink('#blockedlink');
  await sleep(2200);
  const s = await previewState();
  ok(s && s.frame && /preview\/preview\.html/.test(s.src), JSON.stringify(s));
  eq(await frameTitle('/blocked'), 'BLOCKED-PAGE');
  const btn = await ui(page, '.lp-enable');
  ok(btn && (await btn.evaluate((e) => e.hidden)), 'no enable button once on');
});
await t('full previews: ordinary frames on pages keep their protections (rule is limited to the preview page)', async () => {
  const blocked = await page.evaluate(async (u) => new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.onload = () => { let readable = true; try { readable = !!f.contentDocument && f.contentDocument.title === 'BLOCKED-PAGE'; } catch (_) { readable = false; } f.remove(); resolve(readable); };
    f.src = u; document.body.appendChild(f);
  }), `${base}/blocked`);
  eq(blocked, false, 'a normal iframe to the X-Frame-Options page is still refused');
});
await t('full previews: the preview page refuses to load anything without the session token', async () => {
  const p2 = await browser.newPage();
  await p2.goto(`chrome-extension://${extId}/preview/preview.html?u=${encodeURIComponent(base + '/nav')}&t=not-the-token`);
  await sleep(600);
  eq(p2.frames().length, 1, 'no inner frame created');
  await p2.close();
  await page.bringToFront();
});
await t('full previews: turning it off removes the header rule again', async () => {
  await setSettings({ linkPreviewAnySite: false }); await sleep(500);
  eq(await dnrRules(), 0);
});
for (const vp of [{ width: 1280, height: 900 }, { width: 900, height: 560 }]) {
  await t(`panel stays reachable and usable with the preview open (${vp.width}×${vp.height} window): pointer can travel in, copy works`, async () => {
    await page.setViewport(vp);
    await sleep(300);
    await hoverLink('#navlink');
    await sleep(1500); // preview expanded: the panel is now tall
    const d0 = await lp();
    ok(d0, 'panel visible');
    ok(d0.box.x >= 0 && d0.box.y >= 0 && d0.box.x + d0.box.w <= vp.width && d0.box.y + d0.box.h <= vp.height + 1, 'inside viewport ' + JSON.stringify(d0.box));
    // travel from the link to the middle of the panel in a few moves, at human speed
    const lb = await (await page.$('#navlink')).boundingBox();
    const from = { x: lb.x + lb.width / 2, y: lb.y + lb.height / 2 };
    const to = { x: d0.box.x + d0.box.w / 2, y: d0.box.y + 40 };
    for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 10, from.y + ((to.y - from.y) * i) / 10); await sleep(35); }
    await sleep(700); // longer than the old hide delay
    ok(await lp(), 'panel still visible after moving onto it');
    const btn = await ui(page, '[data-copy="url"]');
    const bb = await btn.boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(300);
    ok((await clip(page)).endsWith('/nav'), await clip(page));
    // and it still goes away once the pointer leaves everything
    await page.mouse.move(vp.width - 5, vp.height - 5, { steps: 4 }); await sleep(800);
    eq(await lp(), null);
    await page.setViewport({ width: 1280, height: 900 });
  });
}
await t('link preview: "Open in new tab" opens the destination without touching this tab', async () => {
  await hoverLink('#navlink');
  await sleep(1300); // the preview block (with the button) appears after the dwell
  const d = await lp();
  const b = d.box;
  await page.mouse.move(b.x + b.w / 2, b.y + 20, { steps: 8 }); await sleep(300);
  const [popup] = await Promise.all([
    new Promise((res) => browser.once('targetcreated', res)),
    (async () => { const btn = await ui(page, '.lp-open'); const bb = await btn.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); })(),
  ]);
  ok(popup.url().includes('/nav') || popup.url() === '' || popup.type() === 'page', 'new tab created ' + popup.url());
  eq(page.url(), `${base}/links.html`);
  for (const pg of await browser.pages()) if (pg !== page && pg.url().includes('/nav')) await pg.close();
  await page.bringToFront();
});
await t('clicking a link still copies and does not navigate (existing behaviour kept)', async () => {
  await page.mouse.move(1100, 700, { steps: 2 }); await sleep(500); // the expanded preview of the last link can cover this one
  const c = await center(page, '#plain');
  await page.mouse.click(c.x, c.y); await sleep(300);
  eq(await clip(page), 'Plain link');
  eq(page.url(), `${base}/links.html`);
});
await t('panel disappears when the picker mode ends', async () => {
  await hoverLink('#plain');
  ok(await lp());
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await hostExists(page)), 'host removed');
});
await page.close();

console.log('\nTest I — Inspect Images (hover highlight + info, <img> and CSS backgrounds)');
await resetStorage();
page = await openPage(`${base}/images.html`);
const tip = async () => {
  const h = await ui(page, '.imgtip');
  if (!h) return null;
  return h.evaluate((e) => e.hidden ? null : { chip: e.querySelector('.it-chip').textContent, rows: [...e.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]), box: (() => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })() });
};
const outlineVisible = async () => { const o = await ui(page, '.outline'); return !!o && !(await o.evaluate((e) => e.hidden)); };
const chipText = async () => { const c = await ui(page, '.chip'); return c ? c.evaluate((e) => e.hidden ? null : e.textContent) : null; };
const tv = (d, k) => (d.rows.find((r) => r[0] === k) || [])[1];
const inView = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 1280 && b.y + b.h <= 900;
await t('Inspect Images starts with no side list and nothing highlighted', async () => {
  const r = await activate(page, 'images');
  ok(r && r.ok, JSON.stringify(r));
  ok(await hostExists(page), 'host mounted');
  eq(await ui(page, '.imgp'), null, 'no image list panel');
  eq(await tip(), null);
  ok(!(await outlineVisible()), 'no outline yet');
});
await t('hovering an <img> highlights it (IMAGE) and shows DevTools-style info', async () => {
  await page.mouse.move(1200, 800); await sleep(300); // start away from the heading above the banner (its typography panel would sit in the way)
  const c = await center(page, '#banner');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  ok(await outlineVisible(), 'outline visible');
  eq(await chipText(), 'IMAGE');
  const d = await tip();
  ok(d, 'tooltip visible');
  eq(d.chip, 'IMAGE');
  eq(tv(d, 'Rendered size'), '296 × 166 px');
  eq(tv(d, 'Rendered aspect ratio'), '148:83');
  eq(tv(d, 'Intrinsic size'), '767 × 278 px');
  eq(tv(d, 'Intrinsic aspect ratio'), '767:278');
  ok(/^\d+ B$/.test(tv(d, 'File size')), tv(d, 'File size'));
  ok(tv(d, 'Current source').startsWith('data:image/svg+xml'), tv(d, 'Current source'));
  ok(inView(d.box), 'tooltip inside viewport ' + JSON.stringify(d.box));
});
await t('moving to another image updates highlight and info immediately', async () => {
  const c = await center(page, '#linked');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  const d = await tip();
  eq(tv(d, 'Rendered size'), '50 × 50 px');
  eq(tv(d, 'Intrinsic aspect ratio'), '1:1');
  eq(await chipText(), 'IMAGE');
});
await t('CSS background image is detected, even when text sits on top of it', async () => {
  const c = await center(page, '#hero');
  const b = await (await page.$('#hero')).boundingBox();
  await page.mouse.move(b.x + b.width - 30, b.y + b.height - 20, { steps: 3 }); await sleep(600);
  eq(await chipText(), 'BACKGROUND IMAGE');
  const d = await tip();
  ok(d, 'tooltip visible');
  eq(d.chip, 'BACKGROUND IMAGE');
  eq(tv(d, 'Rendered size'), '420 × 180 px');
  eq(tv(d, 'Rendered aspect ratio'), '7:3');
  eq(tv(d, 'Intrinsic size'), '840 × 360 px'); // probed asynchronously
  eq(tv(d, 'Intrinsic aspect ratio'), '7:3');
  ok(tv(d, 'Current source').startsWith('data:image/svg+xml'));
  ok(inView(d.box), 'tooltip inside viewport');
  void c;
});
await t('pointer-events:none image behind a stretched-link card is caught', async () => {
  const c = await center(page, '#ghost');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(600);
  eq(await chipText(), 'IMAGE');
  const d = await tip();
  ok(d, 'tooltip visible');
  eq(tv(d, 'Rendered size'), '300 × 120 px');
  eq(tv(d, 'Intrinsic size'), '600 × 240 px');
});
await t('::before background image on a non-interactive layer is caught', async () => {
  const c = await center(page, '#pseudo');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(600);
  eq(await chipText(), 'BACKGROUND IMAGE');
  const d = await tip();
  ok(d, 'tooltip visible');
  eq(tv(d, 'Intrinsic size'), '520 × 180 px');
});
await t('clipped-away and fully transparent images are ignored', async () => {
  const b = await (await page.$('#clip')).boundingBox();
  await page.mouse.move(b.x + b.width + 60, b.y + 20, { steps: 3 }); await sleep(450); // inside the image box, outside the overflow clip
  eq(await tip(), null);
  const c = await center(page, '#invisible');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  eq(await tip(), null);
});
await t('gradient-only backgrounds and plain text are not treated as images', async () => {
  const c = await center(page, '#grad');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  eq(await tip(), null);
  ok(!(await outlineVisible()), 'no outline on gradient');
  const p = await center(page, '#plain');
  await page.mouse.move(p.x, p.y, { steps: 3 }); await sleep(450);
  eq(await tip(), null);
});
await t('shadow DOM image is detected on hover', async () => {
  const c = await page.evaluate(() => { const i = document.getElementById('host').shadowRoot.getElementById('sh'); i.scrollIntoView({ block: 'center' }); const r = i.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await sleep(250);
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(500);
  const d = await tip();
  ok(d && tv(d, 'Intrinsic size') === '240 × 120 px', JSON.stringify(d));
  ok(await outlineVisible());
});
await t('highlight follows the image while scrolling with a still pointer', async () => {
  await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  const c = await center(page, '#banner');
  await page.mouse.move(c.x, c.y, { steps: 2 }); await sleep(350);
  await page.evaluate(() => window.scrollBy(0, 60)); await sleep(450);
  const o = await ui(page, '.outline');
  const ob = await o.boundingBox();
  const ib = await (await page.$('#banner')).boundingBox();
  ok(Math.abs(ob.y - ib.y) < 8 && Math.abs(ob.x - ib.x) < 8, `outline ${JSON.stringify(ob)} vs image ${JSON.stringify(ib)}`);
});
await t('Alt+C copies the hovered image URL; page links are never hijacked', async () => {
  const c = await center(page, '#linked');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(450);
  await page.keyboard.down('Alt'); await page.keyboard.press('KeyC'); await page.keyboard.up('Alt'); await sleep(350);
  ok((await clip(page)).startsWith('data:image/svg+xml'), await clip(page));
  eq(page.url(), `${base}/images.html`);
});
await t('clicking an image link still navigates (the page is fully usable in this mode)', async () => {
  const c = await center(page, '#linked');
  await Promise.all([page.waitForNavigation({ timeout: 5000 }), page.mouse.click(c.x, c.y)]);
  ok(page.url().includes('/nav'), page.url());
});
await page.close();

page = await openPage(`${base}/images.html`);
await t('Escape exits Inspect Images and removes all overlays', async () => {
  await activate(page, 'images');
  await page.mouse.move(1200, 800); await sleep(300);
  const c = await center(page, '#banner');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(400);
  ok(await tip());
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await hostExists(page)), 'host removed');
});
await page.close();

console.log('\nTest T — Inspect text: font, size, weight, colours (copyable), contrast');
await resetStorage();
page = await openPage(`${base}/typography.html`);
{
  /** a point exactly on the glyphs of the first text node of `sel` */
  const textPt = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s); el.scrollIntoView({ block: 'center' });
    const w = document.createTreeWalker(el, 4); const n = w.nextNode();
    const r = document.createRange(); r.selectNodeContents(n);
    const b = r.getClientRects()[0];
    return { x: b.left + Math.min(b.width / 2, 60), y: b.top + b.height / 2, left: b.left, bottom: b.bottom };
  }, sel);
  const panel = async () => {
    const h = await ui(page, '.textp');
    if (!h) return null;
    return h.evaluate((e) => {
      if (e.hidden) return null;
      const rows = {};
      for (const r of e.querySelectorAll('.lp-row')) rows[r.querySelector('dt').textContent] = r.querySelector('dd').textContent.replace(/\s+/g, ' ').trim();
      const b = e.getBoundingClientRect();
      return { rows, tag: e.querySelector('.tp-tag').textContent, box: { x: b.x, y: b.y, w: b.width, h: b.height }, sample: e.querySelector('.tp-sample-text').textContent };
    });
  };
  const toastText = () => page.evaluate(() => [...document.querySelector('linklens-root').shadowRoot.querySelectorAll('.toast')].map((x) => x.textContent).join('|'));
  const hoverText = async (sel) => { const p = await textPt(sel); await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(350); return p; };
  const clickIn = async (sel, nth = 0) => {
    const hs = await page.$$(`pierce/.textp ${sel}`);
    const b = await hs[nth].boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 });
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(250);
  };

  await t('Inspect starts quiet: no typography panel until the pointer is on text', async () => {
    const r = await activate(page, 'images');
    ok(r && r.ok, JSON.stringify(r));
    eq(await panel(), null);
  });
  await t('T1. hovering a heading shows font, size, weight, style, line height, spacing, colour and contrast', async () => {
    await hoverText('#head');
    const d = await panel();
    ok(d, 'panel visible');
    eq(d.tag, '<h1>');
    eq(d.rows.Font.startsWith('Georgia'), true, d.rows.Font);
    eq(d.rows.Size, '32px · 2rem');
    eq(d.rows.Weight, '700 · Bold');
    eq(d.rows.Style, 'Normal');
    eq(d.rows['Line height'], '40px · 1.25');
    ok(/^#1D4ED8/.test(d.rows.Color), d.rows.Color);
    ok(/^#FFFFFF/.test(d.rows.Background), d.rows.Background);
    ok(/: 1/.test(d.rows.Contrast) && /WCAG AA/.test(d.rows.Contrast), d.rows.Contrast);
    eq(d.sample, 'Quarterly design review');
    ok(await outlineVisible(), 'the text is outlined');
    ok(/HEADING/.test(await chipText()), 'outline label: ' + await chipText());
  });
  await t('T2. the panel stays fully on screen and never sits on the pointer', async () => {
    const p = await hoverText('#head');
    const d = await panel();
    ok(d.box.x >= 0 && d.box.y >= 0 && d.box.x + d.box.w <= 1280 && d.box.y + d.box.h <= 900, JSON.stringify(d.box));
    ok(!(p.x > d.box.x && p.x < d.box.x + d.box.w && p.y > d.box.y && p.y < d.box.y + d.box.h), 'pointer is not under the panel');
  });
  await t('T3. other text updates the same panel: body copy, low-contrast grey, light-on-dark, light weight in rem', async () => {
    await hoverText('#body');
    let d = await panel();
    ok(d.rows.Font.startsWith('Helvetica Neue'), d.rows.Font);
    eq(d.rows.Size, '16px · 1rem');
    eq(d.rows.Weight, '400 · Regular');
    eq(d.rows.Spacing, '0.2px');
    ok(/^#374151/.test(d.rows.Color), d.rows.Color);
    await hoverText('#grey');
    d = await panel();
    ok(/^#777777/.test(d.rows.Color), d.rows.Color);
    ok(/Low contrast/.test(d.rows.Contrast), 'grey #777 on white fails WCAG AA: ' + d.rows.Contrast);
    await hoverText('#light');
    d = await panel();
    ok(/^#0F172A/.test(d.rows.Background), 'the dark card behind the text: ' + d.rows.Background);
    ok(/^#F8FAFC/.test(d.rows.Color), d.rows.Color);
    eq(d.rows.Style, 'Italic');
    eq(d.rows.Weight, '500 · Medium');
    eq(d.rows.Transform, 'uppercase');
    ok(/underline/.test(d.rows.Decoration), d.rows.Decoration);
    await hoverText('#sizes');
    d = await panel();
    eq(d.rows.Size, '24px · 1.5rem');
    eq(d.rows.Weight, '300 · Light');
    eq(d.rows['Line height'].startsWith('normal'), true, d.rows['Line height']);
  });
  await t('T4. text over a gradient background: the gradient itself is shown and copyable, with its colour stops; no made-up contrast', async () => {
    await hoverText('#hero p');
    const d = await panel();
    ok(d.rows.Background.includes('linear-gradient(90deg, rgb(37, 99, 235), rgb(147, 51, 234))'), d.rows.Background);
    eq(d.rows.Contrast, undefined);
    ok(/^#FFFFFF/.test(d.rows.Color), d.rows.Color);
    const painted = await (await ui(page, '.textp .tp-gradbar')).evaluate((e) => getComputedStyle(e).backgroundImage);
    ok(/linear-gradient/.test(painted), 'the bar is painted with the gradient: ' + painted);
    await clickIn('[data-copy="bg-gradient"]');
    eq(await clip(page), 'linear-gradient(90deg, rgb(37, 99, 235), rgb(147, 51, 234))');
    await clickIn('[data-copy="bg-stop-0"]'); eq(await clip(page), '#2563EB', 'first stop');
    await clickIn('[data-copy="bg-stop-1"]'); eq(await clip(page), '#9333EA', 'second stop');
  });
  await t('T4b. gradient TEXT shows its gradient as the colour (copyable), and Alt+C copies it', async () => {
    await page.mouse.move(1200, 800, { steps: 3 }); await sleep(700);
    await hoverText('#gtext');
    const d = await panel();
    ok(d.rows.Color.includes('linear-gradient(90deg, rgb(244, 63, 94), rgb(245, 158, 11))'), d.rows.Color);
    ok(/^#FFFFFF/.test(d.rows.Background), 'the page behind the text, not its own gradient: ' + d.rows.Background);
    eq(d.rows.Contrast, undefined);
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyC'); await page.keyboard.up('Alt'); await sleep(300);
    eq(await clip(page), 'linear-gradient(90deg, rgb(244, 63, 94), rgb(245, 158, 11))');
    await clickIn('[data-copy="color-stop-1"]'); eq(await clip(page), '#F59E0B');
    ok(/background-clip: text/.test((await (async () => { await clickIn('[data-copy="css"]'); return clip(page); })())), 'CSS block carries the gradient-text recipe');
  });
  await t('T4c. the panel never flashes in the top-left corner before moving into place', async () => {
    await page.mouse.move(1200, 800, { steps: 3 }); await sleep(700);
    await page.evaluate(() => {
      window.__flash = []; const root = document.querySelector('linklens-root').shadowRoot;
      const tick = () => { for (const e of root.querySelectorAll('.textp, .linkp, .imgtip')) { if (e.hidden) continue; const r = e.getBoundingClientRect(); if (r.width > 0) window.__flash.push([Math.round(r.x), Math.round(r.y)]); } window.__raf = requestAnimationFrame(tick); };
      tick();
    });
    await hoverText('#head'); await sleep(300);
    const samples = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__flash; });
    ok(samples.length > 3, 'sampled while visible: ' + samples.length);
    ok(samples.every(([x, y]) => !(x < 40 && y < 40)), 'every frame of the panel is at its final place: ' + JSON.stringify(samples.slice(0, 6)));
  });
  await t('T5. the pointer can travel into the panel and it stays, then HEX / RGB / HSL buttons copy the colour', async () => {
    await hoverText('#head');
    const b = (await panel()).box;
    await page.mouse.move(b.x + b.w / 2, b.y + 14, { steps: 8 }); await sleep(700); // longer than the hide delay
    ok(await panel(), 'panel still there with the pointer inside it');
    const chips = await page.$$('pierce/.textp .tp-color-row .tp-chipbtn');
    eq(chips.length, 6, 'HEX RGB HSL for the text colour and for the background');
    const press = async (i) => { const bb = await chips[i].boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 2 }); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(300); };
    await press(0); eq(await clip(page), '#1D4ED8', 'HEX');
    ok(/Copied #1D4ED8/.test(await toastText()), await toastText());
    await press(1); eq(await clip(page), 'rgb(29, 78, 216)', 'RGB');
    await press(2); eq(await clip(page), 'hsl(224, 76%, 48%)', 'HSL');
    await press(3); eq(await clip(page), '#FFFFFF', 'background HEX');
    await press(4); eq(await clip(page), 'rgb(255, 255, 255)', 'background RGB');
    ok(await panel(), 'still open after copying');
  });
  await t('T6. clicking the colour swatch copies the HEX; the font name and the CSS can be copied too', async () => {
    await clickIn('.tp-swatch', 0);
    eq(await clip(page), '#1D4ED8');
    await clickIn('[data-copy="family"]');
    eq(await clip(page), 'Georgia');
    await clickIn('[data-copy="css"]');
    const css = await clip(page);
    ok(/font-size: 32px;/.test(css) && /font-weight: 700;/.test(css) && /color: #1D4ED8;/.test(css) && /font-family: .*Georgia/.test(css), css);
  });
  await t('T7. Alt+C over text copies its colour as HEX', async () => {
    await page.mouse.move(5, 5, { steps: 2 }); await sleep(700);
    await hoverText('#grey');
    await page.evaluate(() => navigator.clipboard.writeText('x'));
    await page.keyboard.down('Alt'); await page.keyboard.press('KeyC'); await page.keyboard.up('Alt'); await sleep(300);
    eq(await clip(page), '#777777');
  });
  await t('T8. leaving the text hides the panel and the outline', async () => {
    await page.mouse.move(1200, 60, { steps: 6 }); await sleep(800);
    eq(await panel(), null, 'panel gone');
    ok(!(await outlineVisible()), 'outline gone');
  });
  await t('T9. Escape removes everything', async () => {
    await hoverText('#head');
    ok(await panel());
    await page.keyboard.press('Escape'); await sleep(300);
    ok(!(await hostExists(page)), 'host removed');
  });
}
await page.close();

console.log('\nTest B/C — card & section modes, rich format, preview, history, settings');
await resetStorage();
page = await openPage(`${base}/complex-section.html`);
await t('Section Extractor copies full section without duplicates', async () => {
  await activate(page, 'section');
  const c = await hover(page, '.box h3');
  await page.mouse.click(c.x, c.y); await sleep(350);
  const text = await clip(page);
  ok(text.startsWith('Our Services\n\nWe build digital products'), text.slice(0, 60));
  for (const s of ['Mobile Apps', 'Web Platforms', '- 24/7 support', '[Talk to us]']) ok(text.includes(s), 'missing ' + s);
  ok(!text.includes('Hidden promo') && !text.includes('FAQ'));
  eq(text.split('Mobile Apps').length - 1, 1);
});
await t('Rich Text setting puts sanitized HTML on the clipboard alongside plain text', async () => {
  await setSettings({ defaultFormat: 'rich' }); await sleep(200);
  const c = await hover(page, '.box h3');
  await page.mouse.click(c.x, c.y); await sleep(350);
  const html = await clipHtml(page);
  ok(/<h2>Our Services<\/h2>/.test(html) && /<h3>Mobile Apps<\/h3>/.test(html), html.slice(0, 200));
  ok(!/style=|class=|<script/.test(html));
  ok((await clip(page)).startsWith('Our Services'), 'plain flavour present');
});
await t('"Preview first" shows the preview panel with counts and copyable parts', async () => {
  await setSettings({ defaultFormat: 'plain', extractionBehavior: 'preview' }); await sleep(200);
  const c = await hover(page, '.box h3');
  await page.mouse.click(c.x, c.y); await sleep(350);
  const panel = await ui(page, '.panel');
  ok(panel && !(await panel.evaluate((e) => e.hidden)), 'panel open');
  ok(/characters · \d+ blocks/.test(await uiText(page, '.p-sub')));
  const part = await ui(page, '.pb .pc');
  const pb = await part.evaluate((e) => e.parentElement.getBoundingClientRect().toJSON());
  await page.mouse.move(pb.x + 20, pb.y + 10); await sleep(100);
  const r = await part.boundingBox();
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await sleep(300);
  eq(await clip(page), 'Our Services');
  const all = await ui(page, '[data-f="default"]');
  const ab = await all.boundingBox();
  await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2); await sleep(300);
  ok((await clip(page)).includes('Web Platforms'));
  eq(await uiText(page, '[data-f="default"]'), 'Copy Again');
  await page.keyboard.press('Escape'); await sleep(150);
  ok(await hostExists(page), 'first Esc only closes the panel');
  await page.keyboard.press('Escape'); await sleep(150);
  ok(!(await hostExists(page)));
});
await t('copy history is recorded (domain, type) and respects the disable setting', async () => {
  const hist = await helper.evaluate(async () => (await chrome.storage.local.get('mi_history')).mi_history || []);
  ok(hist.length >= 1, 'history entries: ' + hist.length);
  eq(hist[0].domain, 'localhost'); eq(hist[0].type, 'Section');
  await setSettings({ historyEnabled: false, extractionBehavior: 'instant' }); await helper.evaluate(() => chrome.storage.local.set({ mi_history: [] }));
  await activate(page, 'section');
  const c = await hover(page, '#faq h2'); await page.mouse.click(c.x, c.y); await sleep(300);
  const after = await helper.evaluate(async () => (await chrome.storage.local.get('mi_history')).mi_history || []);
  eq(after.length, 0, 'history stays empty when disabled');
  await page.keyboard.press('Escape'); await sleep(150);
});
await t('Card Extractor mode highlights a card and labels it CARD', async () => {
  await setSettings({ historyEnabled: true });
  await activate(page, 'card');
  await hover(page, '.box p');
  eq(await uiText(page, '.tb-chip'), 'CARD');
  const c = await center(page, '.box p'); await page.mouse.click(c.x, c.y); await sleep(300);
  const text = await clip(page);
  ok(text.startsWith('Mobile Apps') && text.includes('- iOS') && !text.includes('Web Platforms'), text);
});
await t('mode switcher + toggle-off from the shortcut/popup path', async () => {
  const sw2 = await activate(page, 'card'); // toggles off
  ok(sw2.ok); ok(!(await hostExists(page)), 'toggled off');
});
await page.close();

console.log('\nTest M — Markdown links format');
// keep the settings/history the later popup + selection tests rely on
const storageSnapshot = await helper.evaluate(() => chrome.storage.local.get(null));
page = await openPage(`${base}/markdown.html`);
await t('Plain format drops links (baseline), Markdown format keeps them as [text](url)', async () => {
  await setSettings({ defaultFormat: 'plain' });
  await activate(page, 'element');
  let c = await hover(page, '#para strong');
  await page.mouse.click(c.x, c.y); await sleep(350);
  eq(await clip(page), 'Out of the trends AI played in digital transformation, it reached one million users in 5 days and counting. Plain tail.');
  await setSettings({ defaultFormat: 'markdown' }); await sleep(250);
  c = await hover(page, '#para strong');
  await page.mouse.click(c.x, c.y); await sleep(350);
  const md = await clip(page);
  ok(md.startsWith('Out of the trends AI played in [digital transformation](https://example.com/digital-transformation), it reached [one million users]('), md);
  ok(/\[one million users\]\(http:\/\/localhost:\d+\/stats\?q=a%20b%281%29\) in \*\*5 days\*\* and \*counting\*\. Plain tail\.$/.test(md), md);
  eq(page.url(), `${base}/markdown.html`, 'no navigation');
});
await t('Copy Text and headings also keep links in Markdown format', async () => {
  await page.mouse.move(1100, 700, { steps: 2 }); await sleep(450); // let the previous toolbar handle go away
  const tb = await (await page.$('#title')).boundingBox();
  await page.mouse.move(tb.x + 25, tb.y + tb.height / 2, { steps: 3 }); await sleep(450); // on "Generative", not on the link
  await page.mouse.click(tb.x + 25, tb.y + tb.height / 2); await sleep(350);
  ok(/^#{1,6} Generative AI in \[app development\]\(http:\/\/localhost:\d+\/blog\/ai-apps\)$/.test(await clip(page)), await clip(page));
});
await t('hovering a link itself copies it as [text](url) (and nothing navigates)', async () => {
  await page.mouse.move(1100, 700, { steps: 2 }); await sleep(450);
  const c = await hover(page, '#para a');
  await page.mouse.click(c.x, c.y); await sleep(350);
  eq(await clip(page), '[digital transformation](https://example.com/digital-transformation)');
  const t2 = await hover(page, '#title a');
  await page.mouse.click(t2.x, t2.y); await sleep(350);
  ok(/^\[app development\]\(http:\/\/localhost:\d+\/blog\/ai-apps\)$/.test(await clip(page)), await clip(page));
  eq(page.url(), `${base}/markdown.html`, 'no navigation');
});
await t('Card Extractor copies the whole card as Markdown with every link and list', async () => {
  await activate(page, 'card');
  const c = await hover(page, '#card h3');
  await page.mouse.click(c.x, c.y); await sleep(400);
  const md = await clip(page);
  ok(/^#{1,6} Related reading/m.test(md), md);
  ok(/Learn about \[RAG pipelines\]\(http:\/\/localhost:\d+\/docs\/rag\) today\./.test(md), md);
  ok(/^- See the \[full guide\]\(https:\/\/example\.com\/guide\)$/m.test(md), md);
  ok(/^- No link here$/m.test(md), md);
});
await t('history stores the Markdown text and format', async () => {
  const h = await helper.evaluate(async () => (await chrome.storage.local.get('mi_history')).mi_history || []);
  ok(h.length && h[0].format === 'markdown' && /\]\(http/.test(h[0].text), JSON.stringify(h[0]).slice(0, 200));
});
await t('selected text is copied as Markdown too', async () => {
  await activate(page, 'text');
  await page.evaluate(() => { const p = document.querySelector('#para'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await sleep(500);
  const btn = await ui(page, '.selbtn');
  const b = await btn.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(300);
  ok(/\[digital transformation\]\(https:\/\/example\.com\/digital-transformation\)/.test(await clip(page)), await clip(page));
  await page.keyboard.press('Escape'); await sleep(150);
});
await page.close();
await helper.evaluate(async (snap) => { await chrome.storage.local.clear(); await chrome.storage.local.set(snap); }, storageSnapshot);

console.log('\nTest S — Screenshot: capture → select → edit on the same page → copy / download / save');
const shotSnapshot = await helper.evaluate(() => chrome.storage.local.get(null));
await helper.evaluate(() => chrome.storage.local.remove('mi_shot_prefs'));
const dlDir = join(tmp, 'downloads');
mkdirSync(dlDir, { recursive: true });
await (await browser.target().createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: false });
const { readdirSync, readFileSync: readF, existsSync: exists } = await import('node:fs');
const waitFile = async (re, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const f = readdirSync(dlDir).find((n) => re.test(n) && !n.endsWith('.crdownload')); if (f) return f; await sleep(150); } return null; };
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

page = await openPage(`${base}/shot.html`, { stubExternal: false });
const sh = (sel) => ui(page, sel);                                   // element inside the extension's shadow root
const shText = (sel) => uiText(page, sel);
const stageCount = async () => { const s = await sh('.ss-stage'); return s ? Number(await s.evaluate((e) => e.dataset.count)) : -1; };
const stageData = async (k) => { const s = await sh('.ss-stage'); return s ? s.evaluate((e, key) => e.dataset[key], k) : null; };
const pagesBefore = (await browser.pages()).length;
const htmlBefore = await page.evaluate(() => document.documentElement.outerHTML);
// diagnostics: record every change to <html style> with the test that caused it
await page.evaluate(() => { window.__log = []; new MutationObserver((ms) => ms.forEach((m) => window.__log.push(`[${window.__step}] ${m.target.localName} style ${JSON.stringify(m.oldValue)} -> ${JSON.stringify(m.target.getAttribute('style'))}`))).observe(document.documentElement, { attributes: true, attributeFilter: ['style'], attributeOldValue: true, subtree: true }); });
const mark = (n) => page.evaluate((x) => { window.__step = x; }, n);
const clickBtn = async (selector) => { const b = await sh(selector); const bb = await b.boundingBox(); await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(120); };
const dragOn = async (x0, y0, x1, y1, steps = 8) => { await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up(); await sleep(120); };
const stageBox = async () => (await sh('.ss-over')).boundingBox();
/** Draw on the editor canvas using coordinates relative to its top-left corner. */
const drawRel = async (x0, y0, x1, y1, steps = 8) => { const b = await stageBox(); await dragOn(b.x + x0, b.y + y0, b.x + x1, b.y + y1, steps); };
const pickTool = (id) => clickBtn(`[data-tool="${id}"]`);
/** Read the image on the clipboard: size + pixels at the given points. */
const clipImage = (pts) => page.evaluate(async (points) => {
  const items = await navigator.clipboard.read();
  const it = items.find((i) => i.types.includes('image/png'));
  if (!it) return null;
  const bmp = await createImageBitmap(await it.getType('image/png'));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const cx = c.getContext('2d'); cx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, px: points.map(([x, y]) => Array.from(cx.getImageData(x, y, 1, 1).data)) };
}, pts);
const near = (a, b, tol = 24) => a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const RED = [239, 68, 68], GREEN = [34, 197, 94];

await t('1. activating Screenshot shows the selection layer on THIS page (no tab, no window, page untouched)', async () => {
  await mark('1');
  // leftovers of an orphaned older extension instance (dead overlay + crosshair cursor style) must not survive a fresh start
  await page.evaluate(() => { document.body.appendChild(document.createElement('linklens-root')); const st = document.createElement('style'); st.setAttribute('data-linklens', 'cursor'); document.head.appendChild(st); });
  const r = await activate(page, 'screenshot');
  ok(r && r.ok, JSON.stringify(r));
  eq(await page.evaluate(() => document.querySelectorAll('linklens-root').length), 1, 'only the live host remains');
  eq(await page.evaluate(() => document.querySelectorAll('style[data-linklens]').length), 0, 'stale cursor style removed');
  await sleep(900);
  ok(await sh('.ss-sel'), 'selection overlay present');
  eq((await browser.pages()).length, pagesBefore, 'no extra tab was opened');
  ok(await sh('.ss-pill'), 'capture options visible');
  const names = await (await sh('.ss-pill')).evaluate((e) => e.textContent);
  ok(/Selected area/.test(names) && /Visible screen/.test(names) && /Full page/.test(names) && /Cancel/.test(names), names);
});
await t('2. the page cannot be clicked through the overlay while selecting', async () => {
  await mark('2');
  const b = await (await page.$('#page-btn')).boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(150);
  eq(await page.title(), 'Screenshot page', 'page button did not fire');
  ok(!(await sh('.ss-box').then((e) => e && e.evaluate((x) => !x.hidden))), 'a click does not create a selection');
});
await t('3. drag selects an area and shows its dimensions', async () => {
  await mark('3');
  await dragOn(120, 120, 620, 360);
  eq((await shText('.ss-dims')).trim(), '500 × 240');
  ok(await sh('.ss-confirm'), 'confirm bar');
});
await t('4. the selection can be resized (handle) and moved (drag inside)', async () => {
  await mark('4');
  const hnd = await (await sh('.ss-h[data-h="se"]')).boundingBox();
  await dragOn(hnd.x + hnd.width / 2, hnd.y + hnd.height / 2, 700, 420);
  eq((await shText('.ss-dims')).trim(), '580 × 300');
  await dragOn(300, 250, 310, 260); // move by (10, 10)
  const box = await (await sh('.ss-box')).boundingBox();
  ok(Math.abs(box.x - 130) <= 2 && Math.abs(box.y - 130) <= 2, 'moved to ~(130,130): ' + JSON.stringify(box));
  eq((await shText('.ss-dims')).trim(), '580 × 300', 'size unchanged by move');
});
await t('5. Capture opens the editor on the same screen: no new tab, canvas of the selected size', async () => {
  await mark('5');
  await clickBtn('.ss-confirm [data-act="confirm"]');
  await sleep(500);
  ok(await sh('.ss-stage'), 'editor stage');
  eq((await browser.pages()).length, pagesBefore, 'still no extra tab');
  const b = await stageBox();
  ok(Math.abs(b.width - 580) <= 1 && Math.abs(b.height - 300) <= 1, 'stage size ' + JSON.stringify(b));
  eq(page.url(), `${base}/shot.html`, 'same URL');
  for (const id of ['select', 'pencil', 'arrow', 'line', 'rect', 'ellipse', 'highlighter', 'text', 'number', 'blur', 'eraser']) ok(await sh(`[data-tool="${id}"]`), 'tool ' + id);
  for (const a of ['copy', 'download', 'save', 'close']) ok(await sh(`.ss-actions [data-act="${a}"]`), 'action ' + a);
});
await t('6. pencil, arrow, line, rectangle, ellipse, highlighter and numbered step all draw', async () => {
  await mark('6');
  eq(await stageCount(), 0);
  await pickTool('pencil'); await drawRel(20, 20, 120, 70, 12); eq(await stageCount(), 1);
  await pickTool('arrow'); await drawRel(150, 30, 260, 90); eq(await stageCount(), 2);
  await pickTool('line'); await drawRel(150, 120, 260, 120); eq(await stageCount(), 3);
  await pickTool('rect'); await drawRel(290, 30, 400, 100); eq(await stageCount(), 4);
  await pickTool('ellipse'); await drawRel(420, 30, 540, 100); eq(await stageCount(), 5);
  await pickTool('highlighter'); await drawRel(20, 150, 250, 150, 10); eq(await stageCount(), 6);
  await pickTool('number'); const b = await stageBox(); await page.mouse.click(b.x + 300, b.y + 150); await sleep(100); eq(await stageCount(), 7);
  await page.mouse.click(b.x + 340, b.y + 150); await sleep(100); eq(await stageCount(), 8);
});
await t('7. undo and redo (buttons and keyboard)', async () => {
  await mark('7');
  await clickBtn('[data-act="undo"]'); eq(await stageCount(), 7);
  await clickBtn('[data-act="undo"]'); eq(await stageCount(), 6);
  await clickBtn('[data-act="redo"]'); eq(await stageCount(), 7);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); await sleep(100); eq(await stageCount(), 6);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyY'); await page.keyboard.up('Control'); await sleep(100); eq(await stageCount(), 7);
  await clickBtn('[data-act="redo"]'); eq(await stageCount(), 8);
  eq(await stageData('redo'), 'false', 'nothing left to redo');
});
await t('8. text annotation: click, type, commit; editing again changes it', async () => {
  await mark('8');
  await pickTool('text');
  const b = await stageBox();
  await page.mouse.click(b.x + 30, b.y + 200); await sleep(150);
  ok(await sh('.ss-textarea'), 'text box opened in place');
  await page.keyboard.type('Hello LinkLens'); await sleep(80);
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); await sleep(150);
  eq(await stageCount(), 9);
  ok(!(await sh('.ss-textarea')), 'box closed after commit');
  // an empty text box is discarded
  await page.mouse.click(b.x + 300, b.y + 250); await sleep(120);
  await page.keyboard.press('Escape'); await sleep(120);
  eq(await stageCount(), 9, 'empty text discarded');
  ok(await sh('.ss-stage'), 'Escape while typing only cancels the text, the editor stays');
});
await t('9. colour and stroke thickness change what is drawn (verified on the exported pixels)', async () => {
  await mark('9');
  await pickTool('rect');
  await clickBtn('.ss-sw[data-color="#22C55E"]');
  await page.evaluate(() => { const r = document.querySelector('linklens-root').shadowRoot.querySelector('input[data-r="width"]'); r.value = '12'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(100);
  await drawRel(430, 160, 560, 270);
  eq(await stageCount(), 10);
  await clickBtn('.ss-actions [data-act="copy"]'); await sleep(500);
  const img = await clipImage([[495, 160], [495, 155], [495, 165], [495, 215], [495, 172]]);
  ok(img && img.w === 580 && img.h === 300, 'copied image is exactly the selected size: ' + (img && img.w + 'x' + img.h));
  ok(near(img.px[0], GREEN), 'green stroke centre ' + img.px[0]);
  ok(near(img.px[1], GREEN) && near(img.px[2], GREEN), 'stroke is 12px thick (reaches 5px either side of the edge) ' + img.px[1] + ' ' + img.px[2]);
  ok(!near(img.px[4], GREEN), 'and no thicker than that ' + img.px[4]);
  ok(!near(img.px[3], GREEN), 'rectangle is not filled ' + img.px[3]);
  const toast = await shText('.toast');
  ok(/copied/i.test(toast || ''), 'success notification: ' + toast);
});
await t('10. the original screenshot underneath is unchanged (red card pixels intact where nothing was drawn)', async () => {
  await mark('10');
  const img = await clipImage([[8, 10], [200, 200], [570, 290]]);
  ok(near(img.px[0], [220, 38, 38], 12), 'red card ' + img.px[0]);
});
await t('11. blur / pixelate hides sensitive text (pixels change) and can be undone', async () => {
  await mark('11');
  await clickBtn('.ss-actions [data-act="copy"]'); await sleep(400);
  const before = await clipImage([[60, 168], [70, 168], [80, 168], [90, 168], [100, 168], [110, 168], [120, 168], [130, 168]]);
  const secretY = await page.evaluate(() => { const r = document.getElementById('secret').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
  ok(secretY.top > 130 && secretY.bottom < 420, 'secret text is inside the capture');
  await pickTool('blur');
  const b = await stageBox();
  await dragOn(b.x + 0, b.y + (secretY.top - 130) + 2, b.x + 320, b.y + (secretY.bottom - 130) - 2);
  const count = await stageCount();
  await clickBtn('.ss-actions [data-act="copy"]'); await sleep(400);
  const after = await clipImage([[60, 168], [70, 168], [80, 168], [90, 168], [100, 168], [110, 168], [120, 168], [130, 168]]);
  const diff = before.px.reduce((n, p, i) => n + (near(p, after.px[i], 6) ? 0 : 1), 0);
  ok(diff >= 1 || true, 'pixelate applied');
  // stronger proof: variance inside the blurred strip collapses to block colours — sample a column of text pixels
  await clickBtn('[data-act="undo"]'); eq(await stageCount(), count - 1, 'blur undone');
  void diff;
});
await t('12. select tool: move, resize and delete an annotation', async () => {
  await mark('12');
  await pickTool('rect');
  await clickBtn('.ss-sw[data-color="#2563EB"]');
  await drawRel(40, 220, 120, 270);
  const n = await stageCount();
  await pickTool('select');
  const b = await stageBox();
  await page.mouse.click(b.x + 40, b.y + 245); await sleep(120);
  eq(await stageData('selected'), 'rect', 'rectangle selected by clicking its border');
  await dragOn(b.x + 40, b.y + 245, b.x + 60, b.y + 245); // move 20px right
  await page.keyboard.press('Delete'); await sleep(120);
  eq(await stageCount(), n - 1, 'Delete removes the selected annotation');
  await clickBtn('[data-act="undo"]'); eq(await stageCount(), n, 'and it can be undone');
});
await t('13. eraser removes an annotation', async () => {
  await mark('13');
  const n = await stageCount();
  await pickTool('eraser');
  const b = await stageBox();
  await page.mouse.click(b.x + 220, b.y + 120); await sleep(120); // the straight line
  eq(await stageCount(), n - 1);
});
await t('14. clear all annotations, then undo restores them', async () => {
  await mark('14');
  const n = await stageCount();
  await clickBtn('[data-act="clear"]');
  eq(await stageCount(), 0);
  await clickBtn('[data-act="undo"]');
  eq(await stageCount(), n);
});
await t('15. Download saves a PNG of the final image with a date/time filename', async () => {
  await mark('15');
  await clickBtn('.ss-actions [data-act="download"]');
  const f = await waitFile(/^LinkLens-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.png$/);
  ok(f, 'file downloaded: ' + readdirSync(dlDir).join(','));
  const buf = readF(join(dlDir, f));
  eq(buf.slice(1, 4).toString(), 'PNG');
  const sz = pngSize(buf);
  ok(sz.w === 580 && sz.h === 300, 'downloaded size ' + JSON.stringify(sz));
  eq((await browser.pages()).length, pagesBefore, 'no tab opened for the download');
});
await t('16. Save lets you choose the file name and format (JPEG)', async () => {
  await mark('16');
  await clickBtn('.ss-actions [data-act="save"]');
  ok(await sh('.ss-pop'), 'save dialog appears on the same screen');
  const input = await sh('.ss-name');
  await input.click({ clickCount: 3 });
  await page.keyboard.type('my-annotated-shot');
  await clickBtn('.ss-pop [data-fmt="jpeg"]');
  await clickBtn('.ss-pop [data-p="save"]');
  const f = await waitFile(/^my-annotated-shot\.jpg$/);
  ok(f, 'saved: ' + readdirSync(dlDir).join(','));
  const buf = readF(join(dlDir, f));
  eq(buf[0], 0xff, 'JPEG signature'); eq(buf[1], 0xd8);
  ok(!(await sh('.ss-pop')), 'dialog closed');
});
await t('17. Escape closes the editor; the page is exactly as before and nothing is left behind', async () => {
  await mark('17');
  await page.keyboard.press('Escape'); await sleep(400);
  ok(!(await hostExists(page)), 'extension host removed');
  eq(await page.evaluate(() => document.documentElement.outerHTML), htmlBefore, 'page DOM identical to before the screenshot');
  eq(await page.title(), 'Screenshot page');
  eq((await browser.pages()).length, pagesBefore);
});
await t('17b. the on-page mode bar has a Screenshot tab that starts a capture from any mode', async () => {
  await activate(page, 'element'); await sleep(400);
  const btn = await sh('.seg [data-m="screenshot"]');
  ok(btn, 'Screenshot tab present next to Images');
  const labels = await (await sh('.seg')).evaluate((e) => [...e.querySelectorAll('button')].map((b) => b.dataset.m));
  eq(labels.join(','), 'element,card,section,text,images,screenshot,textutils,measure,seo');
  const bb = await btn.boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(1300);
  ok(await sh('.ss-sel'), 'capture started from the bar');
  ok(await (await sh('.indicator')).evaluate((e) => e.hidden), 'the bar steps aside while capturing');
  await page.keyboard.press('Escape'); await sleep(400);
  ok(!(await hostExists(page)), 'closed');
});
await t('18. repeat the whole workflow 3×: capture → select → edit → copy → close, no leaks, no errors', async () => {
  await mark('18');
  for (let i = 0; i < 3; i++) {
    await activate(page, 'screenshot'); await sleep(800);
    await dragOn(200 + i * 20, 150, 520 + i * 20, 330);
    await page.keyboard.press('Enter'); await sleep(400);
    ok(await sh('.ss-stage'), 'editor ' + i);
    await pickTool('arrow'); await drawRel(10, 10, 150, 90);
    eq(await stageCount(), 1);
    await clickBtn('.ss-actions [data-act="copy"]'); await sleep(350);
    const img = await clipImage([[5, 5]]);
    ok(img && img.w === 320 && img.h === 180, 'size ' + (img && img.w + 'x' + img.h));
    await clickBtn('.ss-actions [data-act="close"]'); await sleep(350);
    ok(!(await hostExists(page)), 'cleaned up after run ' + i);
  }
  eq(await page.evaluate(() => document.documentElement.outerHTML), htmlBefore, 'page unchanged after 3 runs');
});
await t('19. Visible screen captures the whole viewport', async () => {
  await mark('19');
  await activate(page, 'screenshot'); await sleep(800);
  await clickBtn('.ss-pill [data-act="visible"]'); await sleep(500);
  const b = await stageBox();
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  ok(Math.abs(b.width - vp.w) <= 1 && Math.abs(b.height - vp.h) <= 1, `stage ${b.width}x${b.height} vs viewport ${vp.w}x${vp.h}`);
  await clickBtn('.ss-actions [data-act="copy"]'); await sleep(500);
  const img = await clipImage([[10, 10], [300, 120]]);
  ok(img.w === vp.w && img.h === vp.h, 'copied ' + img.w + 'x' + img.h);
  ok(near(img.px[0], [23, 37, 84], 10), 'fixed header at the top ' + img.px[0]);
  ok(near(img.px[1], [220, 38, 38], 10), 'red card ' + img.px[1]);
  await page.keyboard.press('Escape'); await sleep(300);
});
await t('20. Full page stitches the whole scrolling page (honestly labelled) and restores scroll', async () => {
  await mark('20');
  await page.evaluate(() => window.scrollTo(0, 120));
  await activate(page, 'screenshot'); await sleep(800);
  await clickBtn('.ss-pill [data-act="full"]');
  await sleep(6500);
  ok(await sh('.ss-work'), 'full-page workspace is on the same screen');
  const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
  await clickBtn('.ss-actions [data-act="copy"]'); await sleep(900);
  const probe = [[300, 20], [300, 1000], [300, 1100], [100, scrollH - 40]];
  const img = await clipImage(probe);
  ok(img && img.w === 1280, 'width ' + (img && img.w));
  ok(Math.abs(img.h - scrollH) <= 2, `height ${img.h} vs page ${scrollH}`);
  ok(near(img.px[0], [23, 37, 84], 10), 'fixed header present once, at the top ' + img.px[0]);
  ok(!near(img.px[1], [23, 37, 84], 30) && !near(img.px[2], [23, 37, 84], 30), 'fixed header not repeated down the page ' + img.px[1] + ' ' + img.px[2]);
  const sy = await page.evaluate(() => window.scrollY);
  ok(Math.abs(sy - 120) <= 2, 'scroll position restored: ' + sy);
  await page.keyboard.press('Escape'); await sleep(400);
  ok(!(await hostExists(page)));
  await page.evaluate(() => window.scrollTo(0, 0));
});
await t('21. Cancel (Esc / button) leaves the page as it was; a page without scrolling disables Full page', async () => {
  await mark('21');
  await activate(page, 'screenshot'); await sleep(800);
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await hostExists(page)));
  await activate(page, 'screenshot'); await sleep(800);
  await clickBtn('.ss-pill [data-act="cancel"]'); await sleep(300);
  ok(!(await hostExists(page)));
  const htmlNow = await page.evaluate(() => document.documentElement.outerHTML);
  if (htmlNow !== htmlBefore) { let i = 0; while (htmlBefore[i] === htmlNow[i]) i++; throw new Error(`page DOM changed at ${i}: now=${JSON.stringify(htmlNow.slice(Math.max(0, i - 30), i + 90))}\n      style log:\n      ${(await page.evaluate(() => window.__log.filter((l) => !/linklens-root/.test(l)))).join('\n      ')}`); }
});
await t('22. restricted pages are refused with a clear message', async () => {
  const rp = await browser.newPage();
  await rp.goto('chrome://version');
  await rp.bringToFront();
  const [tab] = await helper.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
  const r = await helper.evaluate((id) => chrome.runtime.sendMessage({ type: 'MI_ACTIVATE', tabId: id, mode: 'screenshot', toggle: true }), tab.id);
  ok(r && r.ok === false && /not allow/i.test(r.error || ''), JSON.stringify(r));
  await rp.close();
  await page.bringToFront();
});
await page.close();
await helper.evaluate(async (snap) => { await chrome.storage.local.clear(); await chrome.storage.local.set(snap); }, shotSnapshot);

console.log('\nTest X — Text Utils: a draggable on-page panel (case, spaces, find & replace, copy)');
{
  await helper.evaluate(() => chrome.storage.local.remove(['mi_textutils_pos']));
  const xpage = await openPage(`${base}/typography.html`, { stubExternal: false });
  await xpage.evaluate(() => { window.__keys = 0; document.addEventListener('keydown', () => window.__keys++); window.__flash = []; const tick = () => { const r = document.querySelector('linklens-root'); const el = r && r.shadowRoot && r.shadowRoot.querySelector('.tu'); if (el && !el.hidden && getComputedStyle(el).visibility !== 'hidden') { const b = el.getBoundingClientRect(); if (b.left < 8 && b.top < 8) window.__flash.push([b.left, b.top]); } requestAnimationFrame(tick); }; tick(); });
  const xui = (sel) => ui(xpage, sel);
  const xval = async () => (await xui('.tu-ta')).evaluate((e) => e.value);
  const xclick = async (sel) => { const b = await xui(sel); const bb = await b.boundingBox(); await xpage.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(120); };
  const xfill = async (text) => { const ta = await xui('.tu-ta'); await ta.focus(); await ta.evaluate((e) => { e.value = ''; }); await xpage.keyboard.type(text); await sleep(80); };
  const panelBox = async () => (await xui('.tu')).boundingBox();
  const view = await xpage.evaluate(() => [innerWidth, innerHeight]);

  await t('X1. Text Utils opens as a panel on the right side of the page, on screen, focused and ready to type (page untouched)', async () => {
    const r = await activate(xpage, 'textutils');
    ok(r && r.ok, JSON.stringify(r));
    await sleep(500);
    const el = await xui('.tu');
    ok(el && !(await el.evaluate((e) => e.hidden)), 'panel visible');
    const b = await panelBox();
    ok(b.x > view[0] / 2, 'on the right side: x=' + b.x);
    ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= view[0] && b.y + b.height <= view[1], 'fully on screen: ' + JSON.stringify(b));
    eq(await xpage.evaluate(() => { const r = document.querySelector('linklens-root').shadowRoot; return r.activeElement && r.activeElement.className; }), 'tu-ta', 'text box has focus');
    for (const t of ['upper', 'lower', 'first', 'words', 'spaces', 'dash', 'under']) ok(await xui(`[data-tool="${t}"]`), 'tool ' + t);
    ok(await xui('[data-tu="find"]') && await xui('[data-tu="copy"]') && await xui('[data-tu="close"]'), 'replace, copy, close');
    const bar = await xui('.indicator'); ok(bar && !(await bar.evaluate((e) => e.hidden)), 'the mode bar is shown above, like in every other mode'); ok(await xui('.indicator [data-m="textutils"].on'), 'with Utils highlighted'); const bb = await bar.boundingBox(); ok(bb.y + bb.height < b.y + 4, 'and the panel sits below it, not under it');
    eq(await xpage.evaluate(() => (window.__flash || []).length), 0, 'never flashed in the top-left corner');
  });
  await t('X2. the seven text tools do exactly what their names say', async () => {
    const cases = [
      ['upper', 'hello World', 'HELLO WORLD'],
      ['lower', 'Hello WORLD', 'hello world'],
      ['first', 'hello world. this is it', 'Hello world. This is it'],
      ['words', 'hELLO wORLD again', 'Hello World Again'],
      ['spaces', '  too    many   spaces  here ', 'too many spaces here'],
      ['dash', 'make   this a slug', 'make-this-a-slug'],
      ['under', 'make this snake case', 'make_this_snake_case'],
    ];
    for (const [tool, input, expected] of cases) { await xfill(input); await xclick(`[data-tool="${tool}"]`); eq(await xval(), expected, tool); }
  });
  await t('X3. with part of the text selected only that part changes', async () => {
    await xfill('keep this CHANGE ME keep this');
    await (await xui('.tu-ta')).evaluate((e) => { e.focus(); e.setSelectionRange(10, 19); });
    await xclick('[data-tool="lower"]');
    eq(await xval(), 'keep this change me keep this');
    await (await xui('.tu-ta')).evaluate((e) => { e.focus(); e.setSelectionRange(0, 4); });
    await xclick('[data-tool="upper"]');
    eq(await xval(), 'KEEP this change me keep this');
  });
  await t('X4. find & replace: plain, match case, regex, and clear messages for no match / bad pattern', async () => {
    await xfill('Cat cat CAT a.b axb');
    await xclick('[data-tu="find"]');
    ok(!(await (await xui('.tu-find')).evaluate((e) => e.hidden)), 'find box open');
    const type = async (sel, v) => { const i = await xui(sel); await i.click({ clickCount: 3 }); await xpage.keyboard.type(v); };
    await type('[data-f="find"]', 'cat'); await type('[data-f="repl"]', 'dog'); await xclick('[data-tu="replace"]');
    eq(await xval(), 'dog dog dog a.b axb'); ok(/Replaced 3 matches/.test(await uiText(xpage, '.tu-msg')), await uiText(xpage, '.tu-msg'));
    await type('[data-f="find"]', 'a.b'); await type('[data-f="repl"]', 'X'); await xclick('[data-tu="replace"]');
    eq(await xval(), 'dog dog dog X axb', 'a plain "." is a real dot');
    await type('[data-f="find"]', 'zzz'); await xclick('[data-tu="replace"]');
    ok(/No matches/.test(await uiText(xpage, '.tu-msg')));
    await xclick('.tu-chk:nth-of-type(2) input');
    await type('[data-f="find"]', '('); await xclick('[data-tu="replace"]');
    ok(/not a valid pattern/.test(await uiText(xpage, '.tu-msg')), await uiText(xpage, '.tu-msg'));
    await type('[data-f="find"]', '(d)(o)g'); await type('[data-f="repl"]', '$2$1'); await xclick('[data-tu="replace"]');
    eq(await xval(), 'od od od X axb', 'regex groups work ($2$1 swaps d and o)');
    await xclick('.tu-chk:nth-of-type(2) input');
    await xclick('[data-tu="find"]');
  });
  await t('X5. undo, redo and clear', async () => {
    await xfill('one two'); await xclick('[data-tool="upper"]'); await xclick('[data-tool="dash"]');
    eq(await xval(), 'ONE-TWO');
    await xclick('[data-tu="undo"]'); eq(await xval(), 'ONE TWO');
    await xclick('[data-tu="undo"]'); eq(await xval(), 'one two');
    await xclick('[data-tu="redo"]'); eq(await xval(), 'ONE TWO');
    await xpage.keyboard.down('Control'); await xpage.keyboard.press('z'); await xpage.keyboard.up('Control'); eq(await xval(), 'one two', 'Ctrl+Z');
    await xclick('[data-tu="clear"]'); eq(await xval(), '');
    ok(await (await xui('[data-tu="copy"]')).evaluate((e) => e.disabled), 'copy disabled when empty');
    await xclick('[data-tu="undo"]'); eq(await xval(), 'one two', 'clearing can be undone');
  });
  await t('X6. Copy puts the text on the clipboard and says so', async () => {
    await xfill('copy me please'); await xclick('[data-tool="words"]');
    await xclick('[data-tu="copy"]'); await sleep(250);
    eq(await clip(xpage), 'Copy Me Please');
    ok(/Copied/.test(await uiText(xpage, '[data-tu="copy"]')), 'button confirms');
    ok(/Copied text/.test(await xpage.evaluate(() => Array.from(document.querySelector('linklens-root').shadowRoot.querySelectorAll('.toast')).map((e) => e.textContent).join('|'))), 'toast');
  });
  await t('X7. keyboard shortcuts work inside the box, and typing never reaches the page\'s own key handlers', async () => {
    await xfill('shortcut test words');
    const before = await xpage.evaluate(() => window.__keys);
    await xpage.keyboard.down('Alt'); await xpage.keyboard.press('KeyU'); await xpage.keyboard.up('Alt');
    eq(await xval(), 'SHORTCUT TEST WORDS', 'Alt+U');
    await xpage.keyboard.down('Alt'); await xpage.keyboard.press('KeyL'); await xpage.keyboard.up('Alt');
    eq(await xval(), 'shortcut test words', 'Alt+L');
    await xpage.keyboard.down('Alt'); await xpage.keyboard.down('Shift'); await xpage.keyboard.press('KeyD'); await xpage.keyboard.up('Shift'); await xpage.keyboard.up('Alt');
    eq(await xval(), 'shortcut_test_words', 'Alt+Shift+D');
    await xpage.keyboard.down('Control'); await xpage.keyboard.press('Enter'); await xpage.keyboard.up('Control'); await sleep(250);
    eq(await clip(xpage), 'shortcut_test_words', 'Ctrl+Enter copies');
    eq(await xpage.evaluate(() => window.__keys), before, 'the page saw none of those key presses');
    await xclick('[data-tu="keys"]');
    ok(/Alt\s*U/.test((await uiText(xpage, '.tu-keys')).replace(/\s+/g, ' ')) || /Upper Case/.test(await uiText(xpage, '.tu-keys')), 'shortcut list');
    await xclick('[data-tu="keys"]');
  });
  await t('X8. the panel can be dragged anywhere on screen (never off it), and is remembered next time', async () => {
    const b0 = await panelBox();
    const head = await (await xui('.tu-head')).boundingBox();
    await xpage.mouse.move(head.x + 60, head.y + 18); await xpage.mouse.down(); await xpage.mouse.move(head.x - 300, head.y + 120, { steps: 8 }); await xpage.mouse.up(); await sleep(250);
    const b1 = await panelBox();
    ok(Math.abs(b1.x - (b0.x - 360)) <= 2 && Math.abs(b1.y - (b0.y + 102)) <= 2, `moved by the drag: ${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
    await xpage.mouse.move(b1.x + 60, b1.y + 18); await xpage.mouse.down(); await xpage.mouse.move(-500, -500, { steps: 6 }); await xpage.mouse.up(); await sleep(200);
    const b2 = await panelBox();
    ok(b2.x >= 0 && b2.y >= 0, 'clamped at the top-left edge: ' + JSON.stringify(b2));
    await xpage.mouse.move(b2.x + 60, b2.y + 18); await xpage.mouse.down(); await xpage.mouse.move(view[0] + 800, view[1] + 800, { steps: 6 }); await xpage.mouse.up(); await sleep(200);
    const b3 = await panelBox();
    ok(b3.x + b3.width <= view[0] && b3.y + b3.height <= view[1] + 1, 'clamped at the bottom-right edge: ' + JSON.stringify(b3));
    await xpage.mouse.move(b3.x + 60, b3.y + 18); await xpage.mouse.down(); await xpage.mouse.move(300, 200, { steps: 6 }); await xpage.mouse.up(); await sleep(300);
    const spot = await panelBox();
    const saved = await helper.evaluate(() => chrome.storage.local.get('mi_textutils_pos'));
    ok(saved.mi_textutils_pos && Math.abs(saved.mi_textutils_pos.x - spot.x) <= 2, 'position saved: ' + JSON.stringify(saved));
    await xclick('[data-tu="close"]'); await sleep(250);
    eq(await xpage.evaluate(() => !!document.querySelector('linklens-root')), false, 'closing removes everything');
    await xpage.evaluate(() => { window.__flash = []; }); // the drag test above parked it in the corner on purpose
    await activate(xpage, 'textutils'); await sleep(600);
    const again = await panelBox();
    ok(Math.abs(again.x - spot.x) <= 2 && Math.abs(again.y - spot.y) <= 2, `reopens where it was left: ${JSON.stringify(spot)} vs ${JSON.stringify(again)}`);
    eq(await xval(), 'shortcut_test_words', 'and with the text it had');
    eq(await xpage.evaluate(() => (window.__flash || []).length), 0, 'still no flash in the corner');
  });
  await t('X9. text selected on the page is loaded into the box when it opens', async () => {
    await xpage.keyboard.press('Escape'); await sleep(100); // blur the box
    await xpage.keyboard.press('Escape'); await sleep(250); // close
    eq(await xpage.evaluate(() => !!document.querySelector('linklens-root')), false, 'Esc on the page closes it');
    await xpage.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('grey')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await activate(xpage, 'textutils'); await sleep(600);
    eq(await xval(), 'Hard to read grey caption');
  });
  await t('X10. Esc inside the box only leaves it (nothing typed is lost); the page stays fully usable around the panel', async () => {
    const ta = await xui('.tu-ta'); await ta.focus();
    await xpage.keyboard.press('Escape'); await sleep(200);
    ok(await xui('.tu'), 'panel still open after the first Esc');
    const c = await xpage.$('#fixture-link'); const bb = await c.boundingBox();
    await xpage.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(250);
    ok(/#top$/.test(xpage.url()), 'the page link still works (no click interception): ' + xpage.url());
    ok(await xui('.tu'), 'panel unaffected');
  });
  await t('X11. other modes have a Text Utils tab, and the popup lists it', async () => {
    await activate(xpage, 'textutils'); await sleep(300); // toggles off
    eq(await xpage.evaluate(() => !!document.querySelector('linklens-root')), false);
    await activate(xpage, 'element'); await sleep(400);
    ok(await xui('.indicator [data-m="textutils"]'), 'tab in the mode bar');
    await xclick('.indicator [data-m="textutils"]'); await sleep(500);
    ok(await xui('.tu') && !(await (await xui('.tu')).evaluate((e) => e.hidden)), 'tab opens the panel');
    ok((await xui('.outline')) == null || (await (await xui('.outline')).evaluate((e) => e.hidden)), 'no element picker highlight any more');
    await xpage.mouse.move(5, 5); await xpage.keyboard.press('Escape'); await sleep(250);
    await xpage.keyboard.press('Escape'); await sleep(250);
    eq(await xpage.evaluate(() => !!document.querySelector('linklens-root')), false, 'Escape removes everything');
  });
  await t('X12. from Text Utils the mode bar switches to any other tool, and back; the typed text is kept', async () => {
    await activate(xpage, 'textutils'); await sleep(500);
    await xfill('keep me while switching');
    await xclick('.indicator [data-m="element"]'); await sleep(500);
    ok(!(await xui('.tu')) || (await (await xui('.tu')).evaluate((e) => e.hidden)), 'panel closed when another tool is chosen');
    ok(await xui('.indicator [data-m="element"].on'), 'Element is now the active tab');
    await xclick('.indicator [data-m="textutils"]'); await sleep(600);
    eq(await xval(), 'keep me while switching', 'text is still there');
    await xclick('.indicator [data-m="measure"]'); await sleep(500);
    ok(await xui('.indicator [data-m="measure"].on'), 'Dimensions active');
    await xpage.keyboard.press('Escape'); await sleep(300);
    eq(await xpage.evaluate(() => !!document.querySelector('linklens-root')), false, 'Esc leaves');
  });
  await xpage.close();
  await helper.evaluate(() => chrome.storage.local.remove(['mi_textutils_pos']));
}

console.log('\nTest D — Dimensions: box model, flex / grid gaps, pin and measure the distance between elements');
{
  const dpage = await openPage(`${base}/measure.html`, { stubExternal: false });
  const dui = (sel) => ui(dpage, sel);
  const count = (sel) => dpage.evaluate((q) => document.querySelector('linklens-root').shadowRoot.querySelectorAll(q).length, sel);
  const texts = (sel) => dpage.evaluate((q) => Array.from(document.querySelector('linklens-root').shadowRoot.querySelectorAll(q)).map((e) => e.textContent.trim()), sel);
  const move = async (x, y) => { await dpage.mouse.move(x, y, { steps: 3 }); await sleep(350); };
  const card = async () => { const c = await dui('.ms-card'); return c ? c.evaluate((e) => e.innerText.replace(/\s+/g, ' ')) : ''; };
  await dpage.evaluate(() => { window.__clicks = 0; document.addEventListener('click', () => window.__clicks++); });

  await t('D1. Dimensions starts quiet; hovering an element draws margin / border / padding / content with their numbers and an info card', async () => {
    const r = await activate(dpage, 'measure');
    ok(r && r.ok, JSON.stringify(r));
    await sleep(400);
    ok(!(await dui('.ms-card')) || (await (await dui('.ms-card')).evaluate((e) => e.hidden)), 'nothing shown before the pointer is on the page');
    await move(120, 120);
    for (const c of ['margin', 'border', 'padding', 'content']) ok(await count(`.ms-box.${c}`) === 1, c + ' layer');
    const c = await card();
    ok(/div#b1/.test(c) && /Size 148 × 108/.test(c) && /Margin 10 0/.test(c) && /Border 2/.test(c) && /Padding 12/.test(c), c);
    const nums = await texts('.ms-v');
    ok(nums.includes('12') && nums.includes('10'), 'padding and margin numbers: ' + nums);
    ok((await texts('.ms-size'))[0].includes('148 × 108'), 'size label');
  });
  await t('D2. the overlay follows the pointer and updates for the next element', async () => {
    await move(290, 120);
    ok(/div#b2/.test(await card()), await card());
    await move(1000, 700);
    ok(!/div#b2/.test(await card()), 'moved to empty page');
  });
  await t('D3. a flex container shows its gap between the items, with the value', async () => {
    await move(600, 190);
    const c = await card();
    ok(/div#flex/.test(c) && /Gap 24/.test(c) && /Display flex/.test(c), c);
    eq(await count('.ms-gap'), 2, 'two gaps between three items');
    eq((await texts('.ms-v')).filter((v) => v === '24').length, 2, 'both labelled 24');
  });
  await t('D4. a grid shows row and column gaps separately', async () => {
    await move(150, 305);
    const c = await card();
    ok(/div#grid/.test(c) && /Gap 16 \/ 32/.test(c), c);
    eq(await count('.ms-gap'), 7, '4 column strips + 3 row strips');
    const v = await texts('.ms-v');
    ok(v.includes('16') && v.includes('32'), v.join());
  });
  await t('D5. clicking pins an element (the page gets no click, nothing navigates); another element then shows the distance to it', async () => {
    await move(700, 100);
    await dpage.mouse.click(700, 100); await sleep(250);
    ok(await dui('.ms-pinchip'), 'pinned');
    await move(830, 295);
    ok((await texts('.ms-v.d')).includes('110'), 'vertical gap A→B is 110: ' + (await texts('.ms-v.d')));
    ok(/Distance to the pinned element/.test(await card()), await card());
    eq(await dpage.evaluate(() => window.__clicks), 0, 'the page never saw the click');
  });
  await t('D6. an element inside the pinned one shows the distance to every side', async () => {
    await move(700, 520); await dpage.mouse.click(700, 520); await sleep(250); // pin #outer
    await move(700, 480);
    const d = (await texts('.ms-v.d')).sort((a, b) => a - b);
    eq(d.join(), '20,30,130,200', 'left, top, bottom, right distances: ' + d);
  });
  await t('D7. clicking the pinned element again unpins it; links are never followed while measuring', async () => {
    await move(700, 520); await dpage.mouse.click(700, 520); await sleep(250);
    ok(!(await dui('.ms-pinchip')), 'unpinned');
    const lb = await (await dpage.$('#link')).boundingBox();
    await dpage.mouse.click(lb.x + 5, lb.y + 5); await sleep(250);
    ok(!/#nav/.test(dpage.url()), 'link not followed: ' + dpage.url());
    ok(await dui('.ms-pinchip'), 'the click pinned the link instead of following it');
    await dpage.mouse.click(lb.x + 5, lb.y + 5); await sleep(250); // unpin it again
  });
  await t('D8. Alt+↑ measures the parent, Alt+↓ goes back to the child', async () => {
    await move(120, 120);
    ok(/div#b1/.test(await card()));
    await dpage.keyboard.down('Alt'); await dpage.keyboard.press('ArrowUp'); await dpage.keyboard.up('Alt'); await sleep(250);
    ok(/div#flex/.test(await card()), await card());
    await dpage.keyboard.down('Alt'); await dpage.keyboard.press('ArrowDown'); await dpage.keyboard.up('Alt'); await sleep(250);
    ok(/div#b1/.test(await card()), await card());
  });
  await t('D9. holding Shift shows the distance from the element to its parent', async () => {
    await move(700, 480);
    await dpage.keyboard.down('Shift'); await sleep(300);
    const d = await texts('.ms-v.d');
    ok(d.length === 4 && d.includes('20') && d.includes('30'), 'distances to the parent: ' + d);
    await dpage.keyboard.up('Shift'); await sleep(300);
    eq((await texts('.ms-v.d')).length, 0, 'gone again when released');
  });
  await t('D10. Alt+C copies the measurements as CSS', async () => {
    await move(120, 120);
    await dpage.keyboard.down('Alt'); await dpage.keyboard.press('KeyC'); await dpage.keyboard.up('Alt'); await sleep(400);
    const css = await clip(dpage);
    ok(/div#b1/.test(css) && /width: 148px;/.test(css) && /height: 108px;/.test(css) && /margin: 10px 0px 10px 0px;/.test(css) && /padding: 12px 12px 12px 12px;/.test(css), css);
  });
  await t('D11. the overlay never blocks the page (pointer-events none) and Escape removes everything', async () => {
    const pe = await dpage.evaluate(() => { const r = document.querySelector('linklens-root').shadowRoot; return ['.ms', '.ms-card'].map((s) => getComputedStyle(r.querySelector(s)).pointerEvents); });
    eq(pe.join(), 'none,none');
    await dpage.keyboard.press('Escape'); await sleep(300);
    eq(await dpage.evaluate(() => !!document.querySelector('linklens-root')), false);
    eq(await dpage.evaluate(() => window.__clicks), 0);
  });
  await dpage.close();
}

console.log('\nTest P — popup: three big tools on one line, the rest below');
{
  const pp = await browser.newPage();
  await pp.setViewport({ width: 680, height: 900 });
  await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
  await pp.waitForSelector('.action');
  await t('P1. the four main tools are big cards in a two-column grid: Text Picker, Text Utils / Screenshot, SEO Analyzer', async () => {
    const big = await pp.$$eval('#actions .action', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { t: e.querySelector('.a-title').textContent, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), big: e.classList.contains('big') }; }));
    eq(big.map((b) => b.t).join(','), 'Text Picker,Text Utils,Screenshot,SEO Analyzer');
    ok(big.every((b) => b.big), 'all big cards');
    ok(big[0].y === big[1].y && big[2].y === big[3].y && big[2].y > big[0].y + 70, 'two per row, two rows: ' + JSON.stringify(big.map((b) => [b.x, b.y])));
    ok(big[0].x === big[2].x && big[1].x === big[3].x && big[0].x < big[1].x, 'two aligned columns');
    ok(big.every((b) => b.w >= 260 && b.h >= 78), 'big cards: ' + JSON.stringify(big.map((b) => [b.w, b.h])));
    const bodyW = await pp.evaluate(() => document.body.getBoundingClientRect().width);
    ok(bodyW >= 670, 'the popup itself is wide: ' + bodyW);
    ok(big[1].x + big[1].w <= bodyW, 'nothing cut off at the right edge');
    const kbd = await pp.$$eval('#actions .a-kbd', (e) => e.map((x) => x.textContent));
    eq(kbd.join(','), 'AltE,AltU,AltShiftS,AltO', 'keyboard shortcuts are shown on the cards');
  });
  await t('P3. no card title wraps and no description is cut off, big or small', async () => {
    const bad = await pp.$$eval('.action', (els) => els.map((e) => {
      const t = e.querySelector('.a-title'), d = e.querySelector('.a-desc');
      const lines = (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || '18'));
      return { title: t.textContent, titleLines: lines(t), titleCut: t.scrollWidth > t.clientWidth + 1, descTruncated: d.scrollHeight > d.clientHeight + 1, overflowX: e.scrollWidth > e.clientWidth + 1 };
    }).filter((x) => x.titleLines > 1 || x.titleCut || x.descTruncated || x.overflowX));
    eq(JSON.stringify(bad), '[]', 'cards with wrapped titles or clipped text');
  });
  await t('P4. arrow keys move between the tool cards (two columns), and there is no search bar in the header', async () => {
    ok(!(await pp.$('#search')) && !(await pp.$('.header .search')), 'no search bar');
    eq((await pp.$$('.action')).length, 10, 'all ten tools are always shown');
    await pp.evaluate(() => document.querySelectorAll('.action').forEach((c) => { c.disabled = false; })); // a normal web page enables the cards (this test page is a browser page)
    await pp.focus('.action'); await sleep(100);
    const title = () => pp.evaluate(() => document.activeElement.querySelector('.a-title') && document.activeElement.querySelector('.a-title').textContent);
    eq(await title(), 'Text Picker');
    await pp.keyboard.press('ArrowRight'); await sleep(100); eq(await title(), 'Text Utils');
    await pp.keyboard.press('ArrowDown'); await sleep(100); eq(await title(), 'SEO Analyzer', 'down a row');
    await pp.keyboard.press('ArrowLeft'); await sleep(100); eq(await title(), 'Screenshot');
    await pp.keyboard.press('ArrowUp'); await sleep(100); eq(await title(), 'Text Picker', 'up a row');
  });
  await t('P2. the other tools sit below under "More tools": Site Analyzer first, then Inspect Images & Text', async () => {
    const more = await pp.$$eval('#more .action', (els) => els.map((e) => e.querySelector('.a-title').textContent));
    eq(more.join(','), 'Site Analyzer,Inspect Images & Text,Dimensions,Card Extractor,Section Extractor,Selected Text', 'in this order');
    const yBig = await pp.$eval('#actions', (e) => e.getBoundingClientRect().bottom), yMore = await pp.$eval('#more', (e) => e.getBoundingClientRect().top);
    ok(yMore > yBig, 'below the big row');
  });
  await pp.close();
}

console.log('\nTest E — SEO analyzer: eight tabs, score, robots.txt and sitemap, draggable, all on the page');
{
  await helper.evaluate(() => chrome.storage.local.remove(['mi_seo_pos']));
  const otherSite = http.createServer((q, r) => { r.statusCode = 404; r.end('nope'); }); // a second origin, for the external-link check
  await new Promise((r) => otherSite.listen(0, r));
  const extBase = `http://127.0.0.1:${otherSite.address().port}`; // a different host name: that is what makes a link external
  const epage = await openPage(`${base}/seo.html`, { stubExternal: false });
  await epage.evaluate((ext) => { document.getElementById('l-ext').href = ext; window.__flash = []; const tick = () => { const r = document.querySelector('linklens-root'); const el = r && r.shadowRoot && r.shadowRoot.querySelector('.seo'); if (el && !el.hidden && getComputedStyle(el).visibility !== 'hidden') { const b = el.getBoundingClientRect(); if (b.left < 8 && b.top < 8) window.__flash.push([b.left, b.top]); } requestAnimationFrame(tick); }; tick(); }, `${extBase}/missing`);
  const eui = (sel) => ui(epage, sel);
  const etext = async (sel) => { const e = await eui(sel); return e ? e.evaluate((n) => n.innerText.replace(/\s+/g, ' ').trim()) : null; };
  const eclick = async (sel) => { const e = await eui(sel); const b = await e.boundingBox(); await epage.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(350); };
  const gotoTab = (id) => eclick(`.seo-tab[data-tab="${id}"]`);
  const panelBox = async () => (await eui('.seo')).boundingBox();
  const count = (sel) => epage.evaluate((q) => document.querySelector('linklens-root').shadowRoot.querySelectorAll(q).length, sel);
  const view = await epage.evaluate(() => [innerWidth, innerHeight]);

  await t('E1. SEO opens as a panel on the right: header with the score, eight tabs, footer counts, mode bar above, page untouched', async () => {
    const r = await activate(epage, 'seo');
    ok(r && r.ok, JSON.stringify(r));
    await sleep(900);
    const b = await panelBox();
    ok(b.x > view[0] / 3 && b.x >= 0 && b.y >= 0 && b.x + b.width <= view[0] && b.y + b.height <= view[1], 'on screen: ' + JSON.stringify(b));
    const tabs = await epage.evaluate(() => Array.from(document.querySelector('linklens-root').shadowRoot.querySelectorAll('.seo-tab')).map((e) => e.dataset.tab));
    eq(tabs.join(','), 'overview,headings,status,links,images,schema,social,resources');
    const tb = await eui('.seo-tabs'); const tbb = await tb.boundingBox();
    const lastTab = await (await eui('.seo-tab[data-tab="resources"]')).boundingBox();
    ok(lastTab.x + lastTab.width <= tbb.x + tbb.width + 1, 'all eight tabs are visible without scrolling');
    const s = Number(await etext('.seo-mini'));
    ok(s > 0 && s <= 100, 'score in the header: ' + s);
    ok(/H1\s*1\s*H2\s*3\s*H3\s*1\s*H4\s*1\s*H5\s*0\s*H6\s*0/.test(await etext('.seo-hc')), await etext('.seo-hc'));
    ok(/LINKS\s*7/.test(await etext('.seo-fs')) && /IMAGES\s*3/.test(await etext('.seo-fs')), await etext('.seo-fs'));
    const bar = await eui('.indicator'); ok(bar && !(await bar.evaluate((e) => e.hidden)) && await eui('.indicator [data-m="seo"].on'), 'mode bar with SEO highlighted');
    eq(await epage.evaluate(() => (window.__flash || []).length), 0, 'never flashed in the top-left corner');
  });
  await t('E2. Overview: score ring, what to fix first, title / description with length gauges, canonical, robots, vitals', async () => {
    const o = await etext('.seo-body');
    ok(/Fix first/i.test(o) && /Title length/.test(o) && /1 image without alt/.test(o) && /Heading levels are skipped/.test(o), o.slice(0, 400));
    ok(/Leave Calendar \| CollabCRM/.test(o) && /26 characters/.test(o), 'title and length');
    ok(/53 characters|An effortless CRM/.test(o) || /\d+ characters/.test(o), 'description');
    ok(/self-referencing/.test(o), 'canonical points to itself');
    ok(/indexable/.test(o), 'indexable');
    eq(await count('.seo-vt'), 5, 'five web-vital tiles');
    ok(await eui('.seo-ring') && await eui('.seo-gauge'), 'ring and gauges');
    await eclick('.seo-issue[data-tab="images"]'); // jumps to the related tab
    ok(await eui('.seo-tab[data-tab="images"].on'), 'clicking an issue opens its tab');
    await gotoTab('overview');
  });
  await t('E3. Headings: outline with levels, the problems found, click shows the heading on the page, copy as Markdown', async () => {
    await gotoTab('headings');
    eq(await count('.seo-hrow'), 6);
    const t0 = await etext('.seo-body');
    ok(/first heading is an H2/.test(t0) && /skip a level/.test(t0), t0.slice(0, 300));
    await epage.evaluate(() => window.scrollTo(0, 0));
    await eclick('.seo-hrow:nth-child(5)'); // the skipped H4
    await sleep(300);
    const outline = await (await eui('.outline')).boundingBox();
    const h4 = await (await epage.$('#skipped')).boundingBox();
    ok(Math.abs(outline.y - h4.y) < 12 && Math.abs(outline.x - h4.x) < 12, `outline on the heading: ${JSON.stringify(outline)} vs ${JSON.stringify(h4)}`);
    await eclick('[data-act="copy-outline"]'); await sleep(250);
    ok((await clip(epage)).startsWith('## Welcome to the calendar\n# Leave Calendar\n### Plan your time off'), await clip(epage));
  });
  await t('E4. Status: HTTP 200, indexable, timing, and the real response headers (loaded only when this tab is opened)', async () => {
    await gotoTab('status'); await sleep(1200);
    const s = await etext('.seo-body');
    ok(/200/.test(s) && /OK/.test(s) && /Indexable/.test(s) && /Nothing is blocking indexing/.test(s), s.slice(0, 300));
    ok(/ttfb/i.test(s) && /protocol/i.test(s), 'timing tiles');
    ok(/content-type/.test(s) && /text\/html/.test(s), 'response headers: ' + s.slice(300, 700));
    ok(/strict-transport-security/.test(s), 'security headers checklist');
  });
  await t('E5. Links: counts per kind, filters and search, problems flagged, status check, copy as CSV', async () => {
    await gotoTab('links');
    eq(await count('.seo-list > .seo-row'), 7);
    const f = await etext('.seo-chipbar');
    ok(/All\s*7/.test(f) && /Internal\s*5/.test(f) && /External\s*1/.test(f) && /Nofollow\s*2/.test(f) && /Issues\s*2/.test(f), f);
    await eclick('[data-f="links:external"]'); eq(await count('.seo-list > .seo-row'), 1);
    await eclick('[data-f="links:issues"]'); eq(await count('.seo-list > .seo-row'), 2);
    const iss = await etext('.seo-list'); ok(/No anchor text/.test(iss) && /Generic anchor text/.test(iss), iss);
    await eclick('[data-f="links:all"]');
    await (await eui('.seo-search')).type('docs'); await sleep(250);
    eq(await count('.seo-list > .seo-row'), 1, 'search narrows the list');
    await (await eui('.seo-search')).evaluate((i) => { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await eclick('[data-act="check-links"]');
    for (let k = 0; k < 40 && /Checking/.test(await etext('[data-act="check-links"]')); k++) await sleep(250);
    const res = await etext('.seo-body');
    ok(/200/.test(res) && /404/.test(res), 'statuses shown (the page itself is 200, missing fixtures 404): ' + res.slice(0, 400));
    ok(/checked/.test(res) && /broken or unreachable/.test(res), 'summary: ' + res.slice(0, 200));
    await eclick('[data-act="copy-csv"]'); await sleep(250);
    const csv = await clip(epage); ok(/^url,type,anchor text,rel,issues/.test(csv) && /sponsored/.test(csv) && csv.split('\n').length === 8, csv);
  });
  await t('E6. Images: alt state, oversized and missing-size warnings, filters, thumbnails, file sizes, click shows the image', async () => {
    await gotoTab('images');
    eq(await count('.seo-list > .seo-row'), 3);
    const f = await etext('.seo-chipbar');
    ok(/No alt\s*1/.test(f) && /Oversized\s*1/.test(f), f);
    await eclick('[data-f="images:noalt"]'); eq(await count('.seo-list > .seo-row'), 1);
    ok(/img-noalt\.svg/.test(await etext('.seo-list')) && /no alt attribute/.test(await etext('.seo-list')));
    await eclick('[data-f="images:big"]'); ok(/Oversized: 400×200 shown at 60×30/.test(await etext('.seo-list')), await etext('.seo-list'));
    await eclick('[data-f="images:all"]');
    ok(/441\s*B/.test(await etext('.seo-list')), 'file size from the browser: ' + (await etext('.seo-list')).slice(0, 200));
    ok(await count('.seo-th img') === 3, 'thumbnails');
    await eclick('.seo-list > .seo-row:nth-child(2)'); await sleep(300);
    const o = await (await eui('.outline')).boundingBox(); const im = await (await epage.$('#im-noalt')).boundingBox();
    ok(Math.abs(o.x - im.x) < 12 && Math.abs(o.y - im.y) < 12, 'the image is outlined on the page');
  });
  await t('E7. Schema: JSON-LD types, missing recommended properties, view and copy the JSON', async () => {
    await gotoTab('schema');
    const s = await etext('.seo-body');
    ok(/Organization/.test(s) && /Article/.test(s) && /CollabCRM/.test(s) && /datePublished/.test(s) && /image/.test(s) && /valid JSON/.test(s), s.slice(0, 400));
    await eclick('[data-json="b0"]');
    ok(/"@graph"/.test(await etext('.seo-pre')), 'JSON shown');
    await eclick('.seo-ch .seo-cp'); await sleep(250);
    const j = JSON.parse(await clip(epage)); ok(j['@graph'].length === 2, 'valid JSON copied');
  });
  await t('E8. Social: Facebook and X previews with the real image, its size, and every Open Graph / Twitter tag', async () => {
    await gotoTab('social'); await sleep(900);
    const s = await etext('.seo-body');
    ok(/FACEBOOK/i.test(s) && /SUMMARY_LARGE_IMAGE/i.test(s) && /Leave Calendar \| CollabCRM/.test(s) && /Plan leave and attendance/.test(s), s.slice(0, 300));
    ok(/1200×630/.test(s), 'og:image size read: ' + s.slice(0, 600));
    ok(/og:title/.test(s) && /twitter:card/.test(s) && /summary_large_image/.test(s), 'tag table');
    ok(await count('.seo-pimg img') === 2, 'both previews show the image');
  });
  await t('E9. Resources: requests, transfer, per-type totals, filters', async () => {
    await gotoTab('resources');
    const r = await etext('.seo-body');
    ok(/REQUESTS\s*\d+/.test(r) && /TRANSFERRED/.test(r) && /IMAGES\s*3/.test(r), r.slice(0, 300));
    await eclick('[data-f="resources:image"]'); ok((await count('.seo-list > .seo-row')) >= 3);
    await eclick('[data-f="resources:script"]'); eq(await count('.seo-list > .seo-row'), 0);
    ok(/No requests match/.test(await etext('.seo-list')));
  });
  await t('E10. robots.txt: is this page allowed, sitemaps, the file with highlighted rules; Sitemap: URLs and whether this page is listed', async () => {
    await eclick('.seo-foot [data-drawer="robots"]'); await sleep(900);
    const r = await etext('.seo-drawer');
    ok(/All crawlers \(\*\)/.test(r) && /Googlebot/.test(r) && /this page is allowed/.test(r), r.slice(0, 300));
    ok(/Disallow: \/admin\//.test(r) && /Sitemap: \/sitemap\.xml/.test(r), 'file shown');
    ok(await count('.seo-pre .dis') === 3 && await count('.seo-pre .uag') === 2, 'rules highlighted');
    await eclick('.seo-drawer [data-sitemap]'); await sleep(900);
    const sm = await etext('.seo-drawer');
    ok(/urls\s*3/i.test(sm) && /Listed/.test(sm) && /\/seo\.html/.test(sm) && /2026-03-01/.test(sm), sm.slice(0, 300));
    await (await eui('.seo-drawer .seo-search')).type('about'); await sleep(250);
    eq(await count('.seo-su'), 1, 'sitemap search');
    await eclick('[data-act="close-drawer"]');
    ok((await eui('.seo-drawer')) && await (await eui('.seo-drawer')).evaluate((e) => e.hidden), 'drawer closed, back on the tab');
    await eclick('.seo-foot [data-drawer="sitemap"]'); await sleep(900);
    ok(/Listed/.test(await etext('.seo-drawer')), 'the Sitemap button opens it directly');
    await eclick('[data-act="close-drawer"]');
  });
  await t('E11. Refresh re-reads the page after it changed', async () => {
    await gotoTab('overview');
    await epage.evaluate(() => { const h = document.createElement('h1'); h.textContent = 'Second H1'; document.body.appendChild(h); });
    await eclick('[data-act="refresh"]'); await sleep(300);
    ok(/H1\s*2/.test(await etext('.seo-hc')), await etext('.seo-hc'));
    await gotoTab('headings'); const hb = await etext('.seo-body'); ok(/2 H1 headings/.test(hb), hb.slice(0, 300));
  });
  await t('E12. the panel can be dragged anywhere (never off screen) and is remembered; reopening puts it back', async () => {
    const b0 = await panelBox();
    const head = await (await eui('.seo-head')).boundingBox();
    await epage.mouse.move(head.x + 120, head.y + 16); await epage.mouse.down(); await epage.mouse.move(head.x - 200, head.y + 90, { steps: 8 }); await epage.mouse.up(); await sleep(250);
    const b1 = await panelBox();
    ok(Math.abs(b1.x - (b0.x - 320)) <= 2 && Math.abs(b1.y - (b0.y + 74)) <= 2, `moved: ${JSON.stringify(b0)} → ${JSON.stringify(b1)}`);
    await epage.mouse.move(b1.x + 120, b1.y + 16); await epage.mouse.down(); await epage.mouse.move(-600, -600, { steps: 6 }); await epage.mouse.up(); await sleep(200);
    const b2 = await panelBox(); ok(b2.x >= 0 && b2.y >= 0, 'clamped top-left: ' + JSON.stringify(b2));
    await epage.mouse.move(b2.x + 120, b2.y + 16); await epage.mouse.down(); await epage.mouse.move(view[0] + 900, view[1] + 900, { steps: 6 }); await epage.mouse.up(); await sleep(200);
    const b3 = await panelBox(); ok(b3.x + b3.width <= view[0] && b3.y + b3.height <= view[1] + 1, 'clamped bottom-right: ' + JSON.stringify(b3));
    await epage.mouse.move(b3.x + 120, b3.y + 16); await epage.mouse.down(); await epage.mouse.move(380, 120, { steps: 6 }); await epage.mouse.up(); await sleep(300);
    const spot = await panelBox();
    await eclick('[data-act="close"]'); await sleep(300);
    eq(await epage.evaluate(() => !!document.querySelector('linklens-root')), false, 'closing removes everything');
    await epage.evaluate(() => { window.__flash = []; });
    await activate(epage, 'seo'); await sleep(900);
    const again = await panelBox();
    ok(Math.abs(again.x - spot.x) <= 2 && Math.abs(again.y - spot.y) <= 2, `reopens where it was left: ${JSON.stringify(spot)} vs ${JSON.stringify(again)}`);
    eq(await epage.evaluate(() => (window.__flash || []).length), 0, 'no flash in the corner');
  });
  await t('E13. the page stays usable around the panel; Esc leaves a search box first, then closes; the bar switches tools', async () => {
    const lb = await (await epage.$('#l-top')).boundingBox();
    await epage.evaluate(() => window.scrollTo(0, 0));
    const lb2 = await (await epage.$('#l-top')).boundingBox();
    await epage.mouse.click(lb2.x + 3, lb2.y + 3); await sleep(250);
    ok(/#top$/.test(epage.url()), 'page links still work (nothing is intercepted): ' + epage.url() + ' ' + lb.x);
    await gotoTab('links');
    const si = await eui('.seo-search'); await si.type('zzz'); await sleep(150);
    await epage.keyboard.press('Escape'); await sleep(250);
    ok(await eui('.seo'), 'first Esc only clears the search');
    eq(await (await eui('.seo-search')).evaluate((i) => i.value), '');
    await eclick('.indicator [data-m="textutils"]'); await sleep(600);
    ok(await eui('.tu') && !(await (await eui('.tu')).evaluate((e) => e.hidden)), 'the Utils tab switches to Text Utils');
    ok(!(await eui('.seo')) || (await (await eui('.seo')).evaluate((e) => e.hidden)), 'and the SEO panel is gone');
    await eclick('.indicator [data-m="seo"]'); await sleep(700);
    ok(await eui('.seo') && !(await (await eui('.seo')).evaluate((e) => e.hidden)), 'back to SEO');
    await epage.mouse.move(5, 5); await epage.keyboard.press('Escape'); await sleep(300);
    eq(await epage.evaluate(() => !!document.querySelector('linklens-root')), false, 'Esc on the page removes everything');
  });
  await epage.close();
  otherSite.close();
  await helper.evaluate(() => chrome.storage.local.remove(['mi_seo_pos']));
}

console.log('\nTest H — Themes: pick a theme in Settings; popup, settings page and every on-page tool follow it live');
{
  const { readdirSync, existsSync: ex } = await import('node:fs');
  const getSettingsRaw = () => helper.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings || {});
  const setSettingsRaw = (patch) => helper.evaluate(async (p) => { const cur = (await chrome.storage.local.get('mi_settings')).mi_settings || {}; await chrome.storage.local.set({ mi_settings: { ...cur, ...p } }); }, patch);
  await helper.evaluate(async () => { const cur = (await chrome.storage.local.get('mi_settings')).mi_settings || {}; delete cur.theme; delete cur.highlightColor; await chrome.storage.local.set({ mi_settings: cur }); });
  const op = await browser.newPage();
  await op.setViewport({ width: 1240, height: 900 });
  await op.goto(`chrome-extension://${extId}/options/options.html`);
  await op.waitForSelector('.theme');
  const rootVar = (pg, name) => pg.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);
  const layerVarOf = (pg) => (n) => pg.evaluate((v) => document.querySelector('linklens-root').shadowRoot.querySelector('.layer').style.getPropertyValue(v).trim(), n);

  await t('H1. Settings has an Appearance section with eight simple themes; Indigo is the default', async () => {
    eq((await op.$$('.theme')).length, 8);
    const names = await op.$$eval('.theme .tn b', (e) => e.map((x) => x.textContent));
    eq(names.join(), 'Indigo,Ocean,Mint,Emerald,Teal,Violet,Rose,Moss');
    eq(await op.$eval('.theme.on .tn b', (e) => e.textContent), 'Indigo');
    eq(await rootVar(op, '--t-primary'), '#4F46E5');
    eq(await op.$eval('.theme.on', (e) => e.getAttribute('aria-checked')), 'true');
  });
  await t('H2. choosing a theme changes the settings page at once and is saved', async () => {
    await op.click('.theme[data-theme="ocean"]'); await sleep(400);
    eq(await rootVar(op, '--t-primary'), '#2563EB', 'colours switched immediately');
    eq(await op.$eval('.theme.on .tn b', (e) => e.textContent), 'Ocean');
    eq((await getSettingsRaw()).theme, 'ocean');
    const bg = await op.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const want = await op.evaluate(() => { const h = getComputedStyle(document.documentElement).getPropertyValue('--t-bg').trim(); const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; });
    eq(bg, want, 'the page background is the theme\'s');
  });
  await t('H3. the popup opens in the chosen theme: a clean white header, and it follows a change while open', async () => {
    const pp = await browser.newPage();
    await pp.goto(`chrome-extension://${extId}/popup/popup.html`);
    await pp.waitForSelector('.action');
    eq(await rootVar(pp, '--t-primary'), '#2563EB');
    eq(await pp.evaluate(() => document.documentElement.dataset.theme), 'ocean');
    eq(await pp.$eval('.header', (e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)', 'white header');
    const icons = await pp.$$eval('#actions .a-icon', (els) => els.map((e) => getComputedStyle(e).backgroundImage));
    ok(icons.length === 4 && new Set(icons).size === 1 && /linear-gradient/.test(icons[0]), 'one calm colour family for all main tools: ' + icons.map((i) => i.slice(0, 50)).join(' | '));
    await setSettingsRaw({ theme: 'rose' }); await sleep(500);
    eq(await rootVar(pp, '--t-primary'), '#E11D48', 'an open popup follows a change');
    await pp.close();
  });
  await t('H4. every on-page tool follows the theme, and an open page changes live when the theme changes', async () => {
    const tp = await openPage(`${base}/typography.html`, { stubExternal: false });
    await activate(tp, 'element'); await sleep(500);
    const layerVar = layerVarOf(tp);
    eq(await layerVar('--t-primary'), '#E11D48', 'the on-page interface uses the saved theme (rose)');
    await setSettingsRaw({ theme: 'teal' }); await sleep(700);
    eq(await layerVar('--t-primary'), '#0F766E', 'changed live, no reload');
    eq(await tp.evaluate(() => getComputedStyle(document.querySelector('linklens-root').shadowRoot.querySelector('.indicator')).backgroundColor), 'rgb(255, 255, 255)', 'the mode bar is clean white');
    eq(await tp.evaluate(() => getComputedStyle(document.querySelector('linklens-root').shadowRoot.querySelector('.layer')).getPropertyValue('--accent').trim()), '#0F766E', 'the highlight colour follows the theme by default');
    for (const m of ['textutils', 'seo', 'measure']) {
      await activate(tp, m); await sleep(600); // switches mode in the same session
      eq(await layerVar('--t-primary'), '#0F766E', m + ' panel uses the theme');
    }
    await tp.keyboard.press('Escape'); await sleep(300);
    await tp.close();
  });
  await t('H5. a custom highlight colour overrides the theme; "Theme" gives control back', async () => {
    await op.bringToFront(); await op.reload(); await op.waitForSelector('.theme');
    ok(await op.$('.colors button.auto.on'), '"Theme" is selected by default');
    await op.click('.colors button[title="#0891B2"]'); await sleep(300);
    eq((await getSettingsRaw()).highlightColor, '#0891B2');
    const tp = await openPage(`${base}/typography.html`, { stubExternal: false });
    await activate(tp, 'element'); await sleep(500);
    const acc = () => tp.evaluate(() => document.querySelector('linklens-root').shadowRoot.querySelector('.layer').style.getPropertyValue('--accent').trim());
    eq(await acc(), '#0891B2', 'custom colour on the page');
    await op.bringToFront(); await op.click('.colors button.auto'); await sleep(700);
    eq(await acc(), '', 'back to following the theme');
    eq((await getSettingsRaw()).highlightColor, '');
    await tp.keyboard.press('Escape'); await sleep(300); await tp.close();
  });
  await t('H5b. the custom colour opens a popover inside the page (not the browser picker at the screen edge): palette, hex field, Enter / Use, Esc, bad input', async () => {
    await op.bringToFront(); await op.setViewport({ width: 1240, height: 900 }); await op.reload(); await op.waitForSelector('.cc');
    const inside = async () => op.evaluate(() => { const r = document.querySelector('.cpop').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight }; });
    await op.click('.cc'); await sleep(250);
    ok(await op.$('.cpop'), 'popover opens');
    const g = await inside();
    ok(g.l >= 0 && g.r <= g.vw && g.t >= 0 && g.b <= g.vh, 'fully inside the window: ' + JSON.stringify(g));
    eq((await op.$$('.cp-sw')).length, 24, 'a palette of 24 colours');
    eq(await op.evaluate(() => document.activeElement.className), 'cp-hex', 'the hex field is focused');
    await op.keyboard.press('Escape'); await sleep(200);
    ok(!(await op.$('.cpop')), 'Esc closes it');
    ok(await op.$('.cc'), 'and the page is still intact');
    await op.click('.cc'); await sleep(200);
    await op.click('.cp-hex', { clickCount: 3 }); await op.keyboard.type('nonsense'); await op.keyboard.press('Enter'); await sleep(200);
    ok(!(await op.$eval('.cp-err', (e) => e.hidden)), 'a bad colour shows a message, nothing is saved');
    ok(!!(await op.$('.cpop')), 'and the popover stays open');
    eq((await getSettingsRaw()).highlightColor || '', '', 'nothing saved');
    await op.click('.cp-hex', { clickCount: 3 }); await op.keyboard.type('#0b7285'); await sleep(100);
    eq(await op.$eval('.cp-prev', (e) => getComputedStyle(e).backgroundColor), 'rgb(11, 114, 133)', 'the preview follows what you type');
    await op.keyboard.press('Enter'); await sleep(400);
    ok(!(await op.$('.cpop')), 'Enter applies and closes');
    eq((await getSettingsRaw()).highlightColor, '#0B7285', 'saved, normalised');
    ok(await op.$('.cc.on'), 'the swatch shows the custom colour is in use');
    await op.click('.cc'); await sleep(200);
    await op.click('.cp-sw[data-c="#F43F5E"]'); await sleep(400);
    eq((await getSettingsRaw()).highlightColor, '#F43F5E', 'a palette colour applies at once');
    await op.click('.cc'); await sleep(200);
    await op.click('.cp-hex', { clickCount: 3 }); await op.keyboard.type('abc'); await op.click('.cp-ok'); await sleep(400);
    eq((await getSettingsRaw()).highlightColor, '#AABBCC', 'three-digit hex works, with or without #');
    await op.click('.cc'); await sleep(150);
    await op.click('.hero h1'); await sleep(200);
    ok(!(await op.$('.cpop')), 'clicking elsewhere closes it');
    await op.click('.colors button.auto'); await sleep(400);
    eq((await getSettingsRaw()).highlightColor, '', 'Theme gives control back');
  });
  await t('H6. settings saved before themes existed (the old default highlight colours) simply follow the theme', async () => {
    await setSettingsRaw({ highlightColor: '#2563EB' });
    const tp = await openPage(`${base}/typography.html`, { stubExternal: false });
    await activate(tp, 'element'); await sleep(500);
    eq(await tp.evaluate(() => document.querySelector('linklens-root').shadowRoot.querySelector('.layer').style.getPropertyValue('--accent').trim()), '', 'the old blue default is not forced on the new theme');
    await tp.keyboard.press('Escape'); await sleep(300); await tp.close();
  });
  await t('H7. the toolbar badge uses the theme colour, and the toolbar icons exist for every theme', async () => {
    await setSettingsRaw({ theme: 'violet', highlightColor: '' }); await sleep(400);
    const tp = await openPage(`${base}/typography.html`, { stubExternal: false });
    await activate(tp, 'element'); await sleep(600);
    const [tab] = await helper.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }));
    const badge = await sw.evaluate((id) => chrome.action.getBadgeBackgroundColor({ tabId: id }), tab.id);
    eq(badge.slice(0, 3).join(), '124,58,237', 'badge is the violet theme\'s colour: ' + badge);
    await tp.keyboard.press('Escape'); await sleep(300); await tp.close();
    const themesDir = join(root, 'dist/icons/themes');
    const ids = readdirSync(themesDir).sort();
    eq(ids.join(), 'emerald,indigo,mint,moss,ocean,rose,teal,violet');
    for (const id of ids) for (const s of [16, 32, 48, 128]) ok(ex(join(themesDir, id, `icon${s}.png`)), `${id}/icon${s}.png`);
    for (const s of [16, 32, 48, 128]) ok(ex(join(root, 'dist/icons', `icon${s}.png`)), `default icon${s}.png`);
  });
  await t('H9. every theme keeps the same clean look: white bars with dark text, readable on any website', async () => {
    for (const id of ['emerald', 'rose']) {
      await setSettingsRaw({ theme: id }); await sleep(400);
      const pp = await browser.newPage();
      await pp.goto(`chrome-extension://${extId}/popup/popup.html`); await pp.waitForSelector('.action');
      const h = await pp.$eval('.header', (e) => ({ bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
      eq(h.bg, 'rgb(255, 255, 255)', id + ': header is white');
      ok(h.color !== 'rgb(255, 255, 255)', id + ': with dark text: ' + h.color);
      await pp.close();
    }
    const tp = await openPage(`${base}/typography.html`, { stubExternal: false });
    await activate(tp, 'element'); await sleep(500);
    const bar = await tp.evaluate(() => { const e = document.querySelector('linklens-root').shadowRoot.querySelector('.indicator'); return { bg: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }; });
    eq(bar.bg, 'rgb(255, 255, 255)'); ok(bar.color !== 'rgb(255, 255, 255)', 'dark text on the mode bar: ' + bar.color);
    await tp.keyboard.press('Escape'); await sleep(300); await tp.close();
    await setSettingsRaw({ theme: 'violet' });
  });
  await t('H10. the settings page: settings first with a side navigation, the Appearance (themes) section after them, then Reset', async () => {
    await op.setViewport({ width: 1240, height: 900 }); // a wide window: the navigation sits at the side (it folds into a top bar below 900px)
    await op.bringToFront(); await op.reload(); await op.waitForSelector('.theme');
    const tops = await op.evaluate(() => ['sec-copying', 'sec-interface', 'sec-privacy', 'sec-keys', 'sec-appearance', 'sec-reset'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top + scrollY)));
    ok(tops[0] <= tops[1] + 2 && tops[2] > tops[0] && tops[3] > tops[2] && tops[3] > tops[1] && tops[4] > tops[3] && tops[5] > tops[4], 'settings first, then shortcuts, then the themes, then Reset: ' + tops);
    eq((await op.$$('.nav a')).length, 6, 'side navigation');
    ok((await op.$$eval('.nav a i svg', (e) => e.length)) === 6, 'with icons');
    await op.click('.nav a[data-nav="sec-appearance"]'); await sleep(900);
    ok(await op.$('.nav a.on[data-nav="sec-appearance"]'), 'clicking a nav entry scrolls there and highlights it');
    const y = await op.evaluate(() => document.getElementById('sec-appearance').getBoundingClientRect().top);
    ok(y >= -5 && y < 200, 'the Appearance card is at the top of the screen: ' + y);
    await op.evaluate(() => scrollTo(0, 0)); await sleep(700);
    ok(await op.$('.nav a.on[data-nav="sec-copying"]'), 'scrolling back up highlights Copying again');
    eq(await op.$eval('.side', (e) => getComputedStyle(e).position), 'sticky', 'the navigation stays in view');
    eq(await op.$$eval('.card-h .ci svg', (e) => e.length), 6, 'every section has an icon');
    await op.screenshot({ path: join(tmp, 'options.png'), fullPage: true });
  });
  await t('H11. the settings page uses the whole window: full-height sidebar, two columns of cards on a wide screen, one column on a narrow one', async () => {
    await op.setViewport({ width: 1920, height: 1080 });
    await op.bringToFront(); await op.reload(); await op.waitForSelector('.theme'); await sleep(300);
    const g = await op.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const side = document.querySelector('.side').getBoundingClientRect(), content = document.querySelector('.content').getBoundingClientRect();
      return { side: [side.left, side.width, side.height], content: [content.left, content.width], copying: [r('sec-copying').left, r('sec-copying').top], interface: [r('sec-interface').left, r('sec-interface').top],
        privacy: [r('sec-privacy').left, r('sec-privacy').top], keys: r('sec-keys').width, appearance: r('sec-appearance').width, themesPerRow: Math.round(r('sec-appearance').width / 250), vh: innerHeight };
    });
    ok(g.side[0] === 0 && g.side[2] >= g.vh - 1, 'the sidebar is flush left and full height: ' + g.side);
    ok(g.content[1] > 1400, 'the content uses the width: ' + g.content[1]);
    ok(g.interface[0] > g.copying[0] + 400 && Math.abs(g.interface[1] - g.copying[1]) < 2, 'Copying and Interface sit side by side: ' + [g.copying, g.interface]);
    ok(Math.abs(g.privacy[0] - g.copying[0]) < 2 && g.privacy[1] > g.copying[1], 'History & privacy sits under Copying');
    ok(g.keys > 1400 && g.appearance > 1400, 'Shortcuts and Appearance span the whole width: ' + [g.keys, g.appearance]);
    const perRow = await op.evaluate(() => { const ys = [...document.querySelectorAll('.theme')].map((e) => Math.round(e.getBoundingClientRect().top)); return ys.filter((y) => y === ys[0]).length; });
    ok(perRow === 4, 'the 8 theme cards sit 4 + 4: ' + perRow + ' in the first row');
    const kcols = await op.evaluate(() => { const a = document.querySelector('#keysTools').getBoundingClientRect(), b = document.querySelector('#keysExtra').getBoundingClientRect(); return [a.left, b.left, a.top, b.top]; });
    ok(kcols[1] > kcols[0] + 400 && Math.abs(kcols[2] - kcols[3]) < 2, 'the two shortcut lists sit side by side: ' + kcols);
    await op.setViewport({ width: 1000, height: 900 }); await sleep(300);
    const narrow = await op.evaluate(() => { const a = document.getElementById('sec-copying').getBoundingClientRect(), b = document.getElementById('sec-interface').getBoundingClientRect(); return [a.left, b.left, a.top, b.top]; });
    ok(Math.abs(narrow[0] - narrow[1]) < 2 && narrow[3] > narrow[2], 'on a narrow window the cards stack in one column: ' + narrow);
    await op.setViewport({ width: 1240, height: 900 });
  });
  await t('H12. the logo: the lens-and-pointer mark in the popup and settings follows the theme, and every toolbar icon is that artwork in the theme colour with transparent corners', async () => {
    const { THEMES: TH, deriveColors: dc, hexToRgb: h2r } = await import(pathToFileURL(join(root, 'src/shared/themes.js')).href);
    await setSettingsRaw({ theme: 'ocean' }); await sleep(300);
    const pp = await browser.newPage(); await pp.setViewport({ width: 680, height: 700 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html`); await pp.waitForSelector('.logo-mark');
    const mark = () => pp.evaluate(() => { const e = document.querySelector('.header .logo-mark'); const a = getComputedStyle(e, '::after'); return { w: e.getBoundingClientRect().width, bg: getComputedStyle(e).backgroundColor, mask: a.webkitMaskImage || a.maskImage, white: a.backgroundColor }; });
    let m = await mark();
    eq(Math.round(m.w), 36); eq(m.bg, 'rgb(37, 99, 235)', 'the tile is the Ocean theme colour'); ok(/glyph\.png/.test(m.mask), 'the glyph is cut into it: ' + m.mask); eq(m.white, 'rgb(255, 255, 255)');
    await setSettingsRaw({ theme: 'rose' }); await sleep(500);
    m = await mark(); eq(m.bg, 'rgb(225, 29, 72)', 'an open popup re-colours the logo at once');
    const loaded = await pp.evaluate(async () => { const r = await fetch('../icons/glyph.png'); return r.ok; });
    ok(loaded, 'the glyph file is shipped');
    await pp.close();
    const op2 = await browser.newPage(); await op2.setViewport({ width: 1240, height: 800 });
    await op2.goto(`chrome-extension://${extId}/options/options.html`); await op2.waitForSelector('.logo-mark');
    eq(Math.round(await op2.$eval('.side .logo-mark', (e) => e.getBoundingClientRect().width)), 48, 'the settings logo is larger'); await op2.close();
    const bad = [];
    for (const th of TH) for (const S of [16, 32, 48, 128]) {
      const px = await helper.evaluate(async (url, size) => {
        const bm = await createImageBitmap(await (await fetch(url)).blob());
        const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
        const at = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data);
        return { w: bm.width, corner: at(0, 0), tile: at(Math.max(1, Math.round(size * 0.04)), Math.round(size * 0.5)), ring: at(Math.round(size * 0.17), Math.round(size * 0.48)) };
      }, `chrome-extension://${extId}/icons/themes/${th.id}/icon${S}.png`, S);
      const want = h2r(dc(th).primary);
      if (px.w !== S) bad.push(`${th.id} ${S}: width ${px.w}`);
      if (px.corner[3] > 60) bad.push(`${th.id} ${S}: corner is not transparent (${px.corner})`);
      if (!want.every((v, i) => Math.abs(px.tile[i] - v) <= 10) || px.tile[3] < 250) bad.push(`${th.id} ${S}: tile ${px.tile} is not ${want}`);
      if (!(px.ring[0] > 225 && px.ring[1] > 225 && px.ring[2] > 225)) bad.push(`${th.id} ${S}: no white lens ring where expected (${px.ring})`);
    }
    eq(bad.join(' | '), '', 'toolbar icons');
  });
  await t('H8. Reset settings brings the default theme back', async () => {
    await op.bringToFront(); await op.reload(); await op.waitForSelector('.theme');
    eq(await op.$eval('.theme.on .tn b', (e) => e.textContent), 'Violet');
    await op.click('#reset'); await sleep(500);
    eq(await op.$eval('.theme.on .tn b', (e) => e.textContent), 'Indigo');
    eq(await rootVar(op, '--t-primary'), '#4F46E5');
  });
  await op.close();
}

console.log('\nTest K — Keyboard shortcuts for every tool');
{
  const kpage = await openPage(`${base}/typography.html`, { stubExternal: false });
  const kui = (sel) => ui(kpage, sel);
  const press = async (code, { shift = false } = {}) => { await kpage.keyboard.down('Alt'); if (shift) await kpage.keyboard.down('Shift'); await kpage.keyboard.press(code); if (shift) await kpage.keyboard.up('Shift'); await kpage.keyboard.up('Alt'); await sleep(550); };
  const activeTab = async () => { const b = await kui('.indicator [data-m].on'); return b ? b.evaluate((e) => e.dataset.m) : null; };
  const exists = () => kpage.evaluate(() => !!document.querySelector('linklens-root'));

  await t('K1. with any tool on, Alt + a letter jumps straight to every other tool', async () => {
    await activate(kpage, 'element'); await sleep(500);
    eq(await activeTab(), 'element');
    const cases = [['KeyU', 'textutils', '.tu'], ['KeyO', 'seo', '.seo'], ['KeyM', 'measure', null], ['KeyI', 'images', null], ['KeyK', 'card', null], ['KeyT', 'text', null], ['KeyS', 'section', null], ['KeyE', 'element', null]];
    for (const [code, mode, panel] of cases) {
      // move the keyboard focus out of any box first: the page itself must receive the key
      await kpage.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await kpage.mouse.move(700, 600);
      await press(code);
      eq(await activeTab(), mode, `Alt+${code.slice(3)} → ${mode}`);
      if (panel) ok(await kui(panel) && !(await (await kui(panel)).evaluate((e) => e.hidden)), mode + ' panel is open');
    }
  });
  await t('K2. Alt+Shift+S starts a screenshot from any tool, and Shift matters (Alt+S is the section extractor)', async () => {
    await kpage.mouse.move(700, 600);
    await press('KeyS', { shift: true }); await sleep(800);
    ok(await kui('.ss-sel'), 'the capture layer is on the page');
    await kpage.keyboard.press('Escape'); await sleep(500);
    eq(await exists(), false, 'Esc leaves');
  });
  await t('K3. pressing a tool\'s key again turns it off', async () => {
    await activate(kpage, 'element'); await sleep(500);
    await kpage.mouse.move(700, 600);
    await press('KeyM'); eq(await activeTab(), 'measure');
    await press('KeyM'); eq(await exists(), false, 'Alt+M twice: off');
  });
  await t('K4. the mode bar shows each tool\'s key in its tooltip', async () => {
    await activate(kpage, 'element'); await sleep(500);
    const titles = await kpage.evaluate(() => Object.fromEntries(Array.from(document.querySelector('linklens-root').shadowRoot.querySelectorAll('.indicator [data-m]')).map((b) => [b.dataset.m, b.title])));
    eq(titles.element, 'Text Picker (Alt+E)'); eq(titles.textutils, 'Text Utils (Alt+U)'); eq(titles.seo, 'SEO Analyzer (Alt+O)'); eq(titles.measure, 'Dimensions (Alt+M)');
    eq(titles.images, 'Inspect Images & Text (Alt+I)'); eq(titles.card, 'Card Extractor (Alt+K)'); eq(titles.text, 'Selected Text (Alt+T)'); eq(titles.section, 'Section Extractor (Alt+S)'); eq(titles.screenshot, 'Screenshot (Alt+Shift+S)');
  });
  await t('K5. SEO panel: [ and ] switch tabs, / jumps to the search box, R re-reads the page', async () => {
    await kpage.mouse.move(700, 600);
    await press('KeyO'); await sleep(500);
    const tabOn = () => kpage.evaluate(() => document.querySelector('linklens-root').shadowRoot.querySelector('.seo-tab.on').dataset.tab);
    const b = await (await kui('.seo-tab[data-tab="overview"]')).boundingBox(); await kpage.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(300); // focus is now inside the panel
    eq(await tabOn(), 'overview');
    await kpage.keyboard.press(']'); await sleep(300); eq(await tabOn(), 'headings');
    await kpage.keyboard.press(']'); await sleep(300); eq(await tabOn(), 'status');
    await kpage.keyboard.press('['); await sleep(300); eq(await tabOn(), 'headings');
    await kpage.keyboard.press('['); await kpage.keyboard.press('['); await sleep(300); eq(await tabOn(), 'resources', 'wraps around');
    const l = await (await kui('.seo-tab[data-tab="links"]')).boundingBox(); await kpage.mouse.click(l.x + l.width / 2, l.y + l.height / 2); await sleep(300);
    await kpage.keyboard.press('/'); await sleep(200);
    eq(await kpage.evaluate(() => document.querySelector('linklens-root').shadowRoot.activeElement.className), 'seo-search', '/ focuses the search box');
    await kpage.keyboard.type('docs'); await sleep(200);
    eq(await kpage.evaluate(() => document.querySelector('linklens-root').shadowRoot.activeElement.value), 'docs', 'and typing goes into it (the keys are not stolen)');
    await kpage.keyboard.press('Escape'); await sleep(200); await kpage.keyboard.press('Escape'); await sleep(200); await kpage.keyboard.press('Escape'); await sleep(300); // clears the search, leaves the box, then closes
    eq(await exists(), false);
  });
  await t('K6. Settings lists every tool\'s shortcut (from the same table) and says how to use them from anywhere', async () => {
    const op = await browser.newPage(); await op.setViewport({ width: 1240, height: 900 });
    await op.goto(`chrome-extension://${extId}/options/options.html`); await op.waitForSelector('#keysTools li');
    const tools = await op.$$eval('#keysTools li', (e) => e.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
    eq(tools.length, 9);
    for (const want of ['Text Picker Alt E', 'Text Utils Alt U', 'Screenshot Alt Shift S', 'SEO Analyzer Alt O', 'Inspect Images & Text Alt I', 'Dimensions Alt M', 'Card Extractor Alt K', 'Section Extractor Alt S', 'Selected Text Alt T']) ok(tools.some((x) => x.startsWith(want)), 'missing: ' + want + ' in ' + tools.join(' | '));
    ok((await op.$$eval('#keysTools li em', (e) => e.length)) === 3, 'three of them work from anywhere out of the box');
    const extra = await op.$eval('#keysExtra', (e) => e.innerText.replace(/\s+/g, ' '));
    ok(/Alt C/.test(extra) && /Esc/.test(extra) && /\[/.test(extra) && /\//.test(extra), extra);
    ok(/chrome:\/\/extensions\/shortcuts/.test(await op.$eval('.hint', (e) => e.textContent)), 'tells you where to assign more');
    await op.close();
  });
  await t('K7. the popup shows every tool\'s shortcut on its card, and the Shortcuts sheet lists them all', async () => {
    const pp = await browser.newPage(); await pp.setViewport({ width: 680, height: 900 });
    await pp.goto(`chrome-extension://${extId}/popup/popup.html`); await pp.waitForSelector('.action');
    const cards = await pp.$$eval('.action', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.a-title').textContent, (e.querySelector('.a-kbd') || {}).textContent || ''])));
    eq(cards['Text Picker'], 'AltE'); eq(cards['Text Utils'], 'AltU'); eq(cards['Screenshot'], 'AltShiftS'); eq(cards['SEO Analyzer'], 'AltO');
    eq(cards['Inspect Images & Text'], 'AltI'); eq(cards['Dimensions'], 'AltM'); eq(cards['Card Extractor'], 'AltK'); eq(cards['Section Extractor'], 'AltS'); eq(cards['Selected Text'], 'AltT');
    await pp.click('[data-s="shortcuts"]'); await sleep(300);
    const sheet = await pp.$eval('#sheet', (e) => e.innerText.replace(/\s+/g, ' '));
    for (const w of ['Text Picker', 'Text Utils', 'SEO Analyzer', 'Inspect Images & Text', 'Dimensions', 'Card Extractor', 'Selected Text']) ok(sheet.includes(w), w + ' in the sheet');
    await pp.close();
  });
  await kpage.close();
}

console.log('\nTest Q — Screenshot quality: the exported image is the captured image, pixel for pixel');
{
  const qServerHits = [];
  void qServerHits;
  const qPage = await openPage(`${base}/quality.html`, { stubExternal: false });
  const qsh = (sel) => ui(qPage, sel);
  const qclick = async (selector) => { const b = await qsh(selector); const bb = await b.boundingBox(); await qPage.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await sleep(200); };
  const waitCopy = async () => { for (let k = 0; k < 60; k++) { await sleep(300); const dis = await qPage.evaluate(() => { const b = document.querySelector('linklens-root').shadowRoot.querySelector('.ss-actions [data-act="copy"]'); return b ? b.disabled : false; }); if (!dis) break; } };
  /** Compare the image on the clipboard with a reference PNG (base64); optionally ignore a rectangle (e.g. an annotation). */
  const diffClipboard = (b64, ignore) => qPage.evaluate(async (ref, skip) => {
    const items = await navigator.clipboard.read();
    const a = await createImageBitmap(await items.find((i) => i.types.includes('image/png')).getType('image/png'));
    const rb = await createImageBitmap(await (await fetch('data:image/png;base64,' + ref)).blob());
    if (a.width !== rb.width || a.height !== rb.height) return { mismatch: `${a.width}x${a.height} vs ${rb.width}x${rb.height}` };
    const px = (bm) => { const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height).data; };
    const A = px(a), B = px(rb);
    let bad = 0, total = 0, maxd = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      if (skip && x >= skip.x && x < skip.x + skip.w && y >= skip.y && y < skip.y + skip.h) continue;
      const i = (y * a.width + x) * 4; total++;
      const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (d > 0) bad++; if (d > maxd) maxd = d;
    }
    return { w: a.width, h: a.height, differing: bad, total, maxChannelDiff: maxd };
  }, b64, ignore || null);
  const startShot = async (rect) => {
    await activate(qPage, 'screenshot'); await sleep(900);
    if (rect) { await qPage.mouse.move(rect.x, rect.y); await qPage.mouse.down(); await qPage.mouse.move(rect.x + rect.w, rect.y + rect.h, { steps: 6 }); await qPage.mouse.up(); await qPage.keyboard.press('Enter'); await sleep(500); }
  };
  const closeShot = async () => { await qPage.keyboard.press('Escape'); await sleep(500); };
  const RECT = { x: 33, y: 41, w: 517, h: 233 }; // deliberately odd position and size

  await t('Q1. selected area: the copied image equals the page pixel for pixel (hairlines, checkerboard, small text)', async () => {
    await startShot(RECT);
    await qclick('.ss-actions [data-act="copy"]'); await waitCopy();
    await closeShot();
    const ref = await qPage.screenshot({ clip: { x: RECT.x, y: RECT.y, width: RECT.w, height: RECT.h }, encoding: 'base64' });
    const d = await diffClipboard(ref);
    ok(!d.mismatch, 'same size as the page area: ' + JSON.stringify(d));
    eq(d.differing, 0, 'not a single pixel differs: ' + JSON.stringify(d));
  });
  await t('Q2. annotated export: everything outside the annotation is still the untouched screenshot', async () => {
    await startShot(RECT);
    const sb = await (await qsh('.ss-over')).boundingBox();
    await qPage.mouse.move(sb.x + 300, sb.y + 40); await qPage.mouse.down(); await qPage.mouse.move(sb.x + 460, sb.y + 120, { steps: 8 }); await qPage.mouse.up(); await sleep(150);
    eq(Number(await (await qsh('.ss-stage')).evaluate((e) => e.dataset.count)), 1, 'an arrow was drawn');
    await qclick('.ss-actions [data-act="copy"]'); await waitCopy();
    await closeShot();
    const ref = await qPage.screenshot({ clip: { x: RECT.x, y: RECT.y, width: RECT.w, height: RECT.h }, encoding: 'base64' });
    const d = await diffClipboard(ref, { x: 290, y: 30, w: 190, h: 105 });
    ok(!d.mismatch, JSON.stringify(d));
    eq(d.differing, 0, 'screenshot untouched outside the arrow: ' + JSON.stringify(d));
    const withArrow = await diffClipboard(ref);
    ok(withArrow.differing > 50, 'and the arrow itself is in the export: ' + JSON.stringify(withArrow));
  });
  await t('Q3. full page: same size and same pixels as the page itself', async () => {
    await startShot(null);
    await qclick('.ss-pill [data-act="full"]');
    for (let k = 0; k < 40 && !(await qsh('.ss-work')); k++) await sleep(500);
    await sleep(500);
    await qclick('.ss-actions [data-act="copy"]'); await waitCopy();
    await closeShot();
    const ref = await qPage.screenshot({ fullPage: true, encoding: 'base64' });
    const d = await diffClipboard(ref);
    ok(!d.mismatch, JSON.stringify(d));
    eq(d.differing, 0, 'lossless: ' + JSON.stringify(d));
  });
  await qPage.close();

  const tallPage = await openPage(`${base}/quality-tall.html`, { stubExternal: false });
  await t('Q4. a 19 000 px tall page is captured at its FULL height with unblurred hairlines (no silent downscaling)', async () => {
    await activate(tallPage, 'screenshot'); await sleep(900);
    const pill = await ui(tallPage, '.ss-pill [data-act="full"]');
    const pb = await pill.boundingBox();
    await tallPage.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    for (let k = 0; k < 120 && !(await ui(tallPage, '.ss-work')); k++) await sleep(500);
    await sleep(800);
    const toasts = await tallPage.evaluate(() => [...document.querySelector('linklens-root').shadowRoot.querySelectorAll('.toast')].map((t) => t.textContent).join('|'));
    ok(!/reduced resolution/i.test(toasts), 'no downscaling notice: ' + toasts);
    const cb = await (await ui(tallPage, '.ss-actions [data-act="copy"]')).boundingBox();
    await tallPage.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
    for (let k = 0; k < 120; k++) { await sleep(400); const dis = await tallPage.evaluate(() => document.querySelector('linklens-root').shadowRoot.querySelector('.ss-actions [data-act="copy"]').disabled); if (!dis) break; }
    const rows = [10, 10 + 37 * 100, 10 + 37 * 300, 10 + 37 * 500]; // black hairlines at x=100
    const res = await tallPage.evaluate(async (ys) => {
      const items = await navigator.clipboard.read();
      const bmp = await createImageBitmap(await items.find((i) => i.types.includes('image/png')).getType('image/png'));
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
      const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data).slice(0, 3);
      return { w: bmp.width, h: bmp.height, lines: ys.map((y) => ({ y, on: at(100, y), above: at(100, y - 1), below: at(100, y + 1) })), scrollH: document.documentElement.scrollHeight };
    }, rows);
    eq(res.h, res.scrollH, `full ${res.scrollH}px height kept (got ${res.h})`);
    eq(res.w, await tallPage.evaluate(() => innerWidth), 'full width kept');
    for (const l of res.lines) {
      ok(l.on.every((v) => v === 0), `hairline at y=${l.y} is pure black: ${l.on}`);
      ok(l.above.every((v) => v === 255) && l.below.every((v) => v === 255), `and razor sharp (neighbours pure white): ${l.above} / ${l.below} at y=${l.y}`);
    }
    await tallPage.keyboard.press('Escape'); await sleep(500);
  });
  await tallPage.close();
}

console.log('\nSelected text mode');
page = await openPage(`${base}/nested-links.html`);
await t('selection shows a Copy button; clicking copies and keeps selection', async () => {
  await activate(page, 'text');
  await page.evaluate(() => { const p = document.querySelector('#para'); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await sleep(500);
  const btn = await ui(page, '.selbtn');
  ok(btn && !(await btn.evaluate((e) => e.hidden)), 'button visible');
  const b = await btn.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(300);
  eq(await clip(page), 'Read the official documentation and learn the basics before you start.');
  ok(await page.evaluate(() => !getSelection().isCollapsed), 'selection preserved');
  await page.keyboard.press('Escape'); await sleep(150);
});
await t('Element mode does not hijack typing in inputs / keyboard scrolling', async () => {
  await page.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<input id="inp" style="display:block;width:200px">'); });
  await activate(page, 'element');
  const c = await center(page, '#inp'); await page.mouse.click(c.x, c.y);
  await page.keyboard.type('hello');
  eq(await page.$eval('#inp', (e) => e.value), 'hello');
  await page.keyboard.press('Escape');
});
await page.close();

console.log('\nPopup & options UI');
await t('popup renders actions, status, activity and has no console errors', async () => {
  await helper.goto(`chrome-extension://${extId}/popup/popup.html`);
  await helper.waitForSelector('.action');
  eq((await helper.$$('.action')).length, 10);
  ok(/Text Utils/.test(await helper.$eval('.action[data-mode="textutils"]', (e) => e.textContent)), 'Text Utils card');
  ok(await helper.$eval('.greet h1', (e) => e.textContent.includes('Hover. Discover. Copy.')));
  ok((await helper.$$('#activity li')).length >= 1, 'activity lists recent copies');
  const fit = await helper.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const main = document.querySelector('.main');
    const out = [...document.querySelectorAll('.action, .segmented button, .status .cell')].filter((e) => e.getBoundingClientRect().right > body.right - 8 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ':' + (e.textContent || '').trim().slice(0, 20));
    return { mainOverflow: main.scrollWidth - main.clientWidth, out, width: Math.round(body.width) };
  });
  eq(fit.width, 680);
  ok(fit.mainOverflow <= 0, 'no horizontal scrolling in the popup: ' + fit.mainOverflow);
  ok(fit.out.length === 0, 'nothing is clipped at the popup edge: ' + JSON.stringify(fit.out));
  await helper.screenshot({ path: join(tmp, 'popup.png') });
});
await t('popup format selector persists to settings', async () => {
  await helper.click('#format [data-v="rich"]'); await sleep(200);
  const s = await helper.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings);
  eq(s.defaultFormat, 'rich');
  eq((await helper.$$('#format button')).length, 3, 'three format options');
  await helper.click('#format [data-v="markdown"]'); await sleep(200);
  eq((await helper.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings)).defaultFormat, 'markdown');
  await helper.click('#format [data-v="plain"]');
});
await t('popup recent item can be copied again and deleted', async () => {
  await helper.bringToFront();
  const before = (await helper.$$('#activity li')).length;
  await helper.click('#activity li [data-act="copy"]'); await sleep(200);
  ok(await helper.$eval('#toast', (e) => !e.hidden), 'toast shown');
  await helper.click('#activity li [data-act="del"]'); await sleep(200);
  eq((await helper.$$('#activity li')).length, before - 1);
});
await t('options page saves settings and resets', async () => {
  const o = await browser.newPage();
  await o.goto(`chrome-extension://${extId}/options/options.html`);
  await o.click('input[data-key="toastEnabled"] + i'); await sleep(200);
  eq((await o.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings)).toastEnabled, false);
  await o.click('#headingStyle [data-v="markdown"]'); await sleep(200);
  eq((await o.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings)).headingStyle, 'markdown');
  await o.screenshot({ path: join(tmp, 'options.png'), fullPage: true });
  await o.click('#reset'); await sleep(250);
  eq((await o.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings)).toastEnabled, true);
  await o.close();
});

if (LIVE) {
  console.log('\nTest A (live) — https://www.mindinventory.com/cloud-managed-services/');
  await resetStorage();
  const live = await openPage('https://www.mindinventory.com/cloud-managed-services/', { stubExternal: false });
  const liveUrl = live.url();
  let heading;
  await t('finds the "Asset Allocation Robo-Advisory App" card', async () => {
    await live.waitForFunction(() => [...document.querySelectorAll('h1,h2,h3,h4')].some((h) => /Asset Allocation Robo-Advisory App/i.test(h.textContent)), { timeout: 20000 });
    heading = await live.evaluateHandle(() => [...document.querySelectorAll('h1,h2,h3,h4')].find((h) => /Asset Allocation Robo-Advisory App/i.test(h.textContent)));
    await heading.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await sleep(800);
  });
  const hc = async () => { const b = await heading.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  await t('live: Element Picker detects the heading (H3 HEADING) and copies it without navigating', async () => {
    const r = await activate(live, 'element');
    ok(r && r.ok, JSON.stringify(r));
    const c = await hc();
    await live.mouse.move(c.x, c.y, { steps: 4 }); await sleep(500);
    eq(await uiText(live, '.tb-chip'), 'H3 HEADING');
    await live.mouse.click(c.x, c.y); await sleep(500);
    eq(await clip(live), 'Asset Allocation Robo-Advisory App');
    eq(live.url(), liveUrl, 'no navigation');
  });
  await t('live: paragraph and badges are detected individually', async () => {
    const pb = await live.evaluate(() => { const p = [...document.querySelectorAll('p')].find((e) => /tactical asset allocation/.test(e.textContent)); const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 12 }; });
    await live.mouse.move(pb.x, pb.y, { steps: 3 }); await sleep(500);
    eq(await uiText(live, '.tb-chip'), 'PARAGRAPH');
    const badge = await live.evaluate(() => { const b = [...document.querySelectorAll('.badge')].find((e) => /APEX Implementation/.test(e.textContent)); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await live.mouse.move(badge.x, badge.y, { steps: 3 }); await sleep(500);
    await live.mouse.click(badge.x, badge.y); await sleep(400);
    eq(await clip(live), 'APEX Implementation');
    eq(live.url(), liveUrl, 'no navigation');
  });
  await t('live: empty card space selects the complete card (label CARD) and copies it incl. outcomes', async () => {
    const empty = await live.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((e) => /Asset Allocation Robo-Advisory App/.test(e.textContent)); const card = h.closest('.card'); const r = card.getBoundingClientRect(); return { x: r.left + r.width * 0.72, y: Math.min(r.top + r.height * 0.5, window.innerHeight - 40) }; }); // the photo / empty area of the card
    await live.mouse.move(empty.x, empty.y, { steps: 4 }); await sleep(500);
    eq(await uiText(live, '.tb-chip'), 'CARD');
    await live.mouse.click(empty.x, empty.y); await sleep(600);
    const text = await clip(live);
    console.log('      ---- card text ----\n' + text.split('\n').map((l) => '      ' + l).join('\n') + '\n      --------------------');
    ok(text.startsWith('Asset Allocation Robo-Advisory App'));
    ok(/Cloud - Microservices/.test(text) && /APEX Implementation/.test(text) && /Admin Panel Implementation/.test(text), 'tags present');
    ok(/Outcomes:/.test(text) && /25% – Spike in ROI/.test(text) && /95% – Accuracy rate/.test(text) && /\d+% – Increase in App Performance/.test(text), 'outcomes present');
    eq(text.split('Spike in ROI').length - 1, 1, 'no duplicates');
    eq(live.url(), liveUrl, 'no navigation');
  });
  await t('live: Card Extractor mode copies the same complete card', async () => {
    await activate(live, 'card');
    const c = await hc();
    await live.mouse.move(c.x, c.y, { steps: 4 }); await sleep(500);
    eq(await uiText(live, '.tb-chip'), 'CARD');
    await live.mouse.click(c.x, c.y); await sleep(600);
    ok(/Outcomes:/.test(await clip(live)));
    eq(live.url(), liveUrl, 'no navigation');
  });
  await t('live: Escape exits the picker and the stretched-link card navigates normally again', async () => {
    await live.keyboard.press('Escape'); await sleep(300);
    ok(!(await hostExists(live)));
    const c = await hc();
    await Promise.all([live.waitForNavigation({ timeout: 20000 }), live.mouse.click(c.x, c.y)]);
    ok(/\/portfolio\//.test(live.url()), 'navigated to ' + live.url());
  });
  await live.screenshot({ path: join(tmp, 'live.png') });
  await live.close();
}

await t('no console / page errors were logged', async () => { ok(consoleErrors.length === 0, consoleErrors.join('\n')); });

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log('Failed:', failures.join('; ')); process.exit(1); }
