// Sanity-checks dist/ so "Load unpacked → dist" works: every manifest path exists, bundles are classic scripts.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const errors = [];
const need = (rel, why) => { if (!existsSync(join(dist, rel))) errors.push(`missing ${rel} (${why})`); };

const m = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
if (m.manifest_version !== 3) errors.push('manifest_version must be 3');
Object.values(m.icons || {}).forEach((f) => need(f, 'icons'));
Object.values((m.action && m.action.default_icon) || {}).forEach((f) => need(f, 'action icon'));
need(m.action.default_popup, 'popup');
need(m.options_ui.page, 'options page');
need(m.background.service_worker, 'service worker');
for (const html of [m.action.default_popup, m.options_ui.page, 'preview/preview.html']) {
  const src = readFileSync(join(dist, html), 'utf8');
  for (const [, ref] of src.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:/.test(ref)) errors.push(`${html} references remote resource ${ref}`);
    else need(join(dirname(html), ref), `${html} reference`);
  }
}
for (const f of ['content/index.js', 'background/service-worker.js', 'popup/popup.js', 'options/options.js', 'preview/preview.js', 'preview/preview.html']) {
  need(f, 'bundle');
  if (existsSync(join(dist, f))) {
    const code = readFileSync(join(dist, f), 'utf8');
    if (/(^|\n)\s*(import|export)\s[^(]/.test(code)) errors.push(`${f} still contains ES module syntax`);
    if (/https?:\/\/(?!www\.w3\.org|claude\.com|chrome\.google|github)[a-z0-9.-]+\/[^"'\s]*\.js\b/i.test(code)) errors.push(`${f} loads remote script`);
  }
}
const perms = m.permissions || [];
// the only required host access: the Wayback Machine's capture counts for Domain Authority (that endpoint sends no CORS headers)
const allowedHosts = ['https://web.archive.org/*'];
if ((m.host_permissions || []).some((p) => !allowedHosts.includes(p)) || perms.includes('tabs') || perms.includes('<all_urls>')) errors.push('unexpected broad permissions (all-sites access must stay optional)');
const allowedOptional = ['<all_urls>'];
if ((m.optional_host_permissions || []).some((p) => !allowedOptional.includes(p))) errors.push('unexpected optional host permissions');

if (errors.length) { console.error('✗ dist verification failed:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log(`✔ dist OK — manifest v${m.version}, permissions: ${perms.join(', ')}`);
