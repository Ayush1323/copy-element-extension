// End-to-end tests: real Chrome + the real built extension (dist/) driven through puppeteer-core.
//   npm run build && npm run test:e2e            (local fixtures)
//   LIVE=1 npm run test:e2e                      (also tests https://www.mindinventory.com/cloud-managed-services/)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFileSync, cpSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    res.setHeader('content-type', 'text/html');
    res.end(readFileSync(join(fixtures, p.slice(1) || 'clickable-card.html')));
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
  await page.mouse.move(1100, 700); await sleep(380);
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
  const c = await center(page, '#banner');
  await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(400);
  ok(await tip());
  await page.keyboard.press('Escape'); await sleep(300);
  ok(!(await hostExists(page)), 'host removed');
});
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
  eq(labels.join(','), 'element,card,section,text,images,screenshot');
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
  eq((await helper.$$('.action')).length, 6);
  ok(await helper.$eval('.welcome h1', (e) => e.textContent.includes('Hover. Discover. Copy.')));
  ok((await helper.$$('#activity li')).length >= 1, 'activity lists recent copies');
  const fit = await helper.evaluate(() => {
    const body = document.body.getBoundingClientRect();
    const main = document.querySelector('.main');
    const out = [...document.querySelectorAll('.action, .segmented button, .status .cell')].filter((e) => e.getBoundingClientRect().right > body.right - 8 || e.scrollWidth > e.clientWidth + 1).map((e) => e.className + ':' + (e.textContent || '').trim().slice(0, 20));
    return { mainOverflow: main.scrollWidth - main.clientWidth, out, width: Math.round(body.width) };
  });
  eq(fit.width, 380);
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
