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
mf.host_permissions = ['http://localhost/*', 'https://www.mindinventory.com/*'];
writeFileSync(join(tmp, 'ext/manifest.json'), JSON.stringify(mf));
// Production uses a *closed* shadow root. For tests only, open it so puppeteer can query the extension UI.
const cs = join(tmp, 'ext/content/index.js');
const bundle = readFileSync(cs, 'utf8');
if (!/mode:"closed"/.test(bundle)) throw new Error('closed shadow root marker not found in bundle');
writeFileSync(cs, bundle.replace('mode:"closed"', 'mode:"open"'));

const fixtures = join(root, 'tests/fixtures');
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
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
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) consoleErrors.push(`${url}: ${m.text()}`); });
  if (stubExternal) {
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      if (u.startsWith(base) || u.startsWith('data:')) r.continue();
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
const hostExists = (page) => page.evaluate(() => !!document.querySelector('mi-instant-copy-root'));
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
    eq(await clip(page), wanted[i]);
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
  eq((await helper.$$('.action')).length, 4);
  ok(await helper.$eval('.welcome h1', (e) => e.textContent.includes('Copy website content effortlessly.')));
  ok((await helper.$$('#activity li')).length >= 1, 'activity lists recent copies');
  await helper.screenshot({ path: join(tmp, 'popup.png') });
});
await t('popup format selector persists to settings', async () => {
  await helper.click('#format [data-v="rich"]'); await sleep(200);
  const s = await helper.evaluate(async () => (await chrome.storage.local.get('mi_settings')).mi_settings);
  eq(s.defaultFormat, 'rich');
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
