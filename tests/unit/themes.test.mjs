import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const T = await import('../../src/shared/themes.js');
const css = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
const SHEETS = ['content/styles/injected.css', 'popup/popup.css', 'options/options.css'];

test('a small, simple set of themes with a default; ids are unique and the anchor colours are valid', () => {
  assert.ok(T.THEMES.length >= 5 && T.THEMES.length <= 8, 'few themes, all of them good');
  assert.equal(new Set(T.THEMES.map((t) => t.id)).size, T.THEMES.length);
  assert.ok(T.THEMES.some((t) => t.id === T.DEFAULT_THEME));
  for (const t of T.THEMES) {
    assert.ok(t.name && t.mood, t.id);
    for (const k of ['primary', 'accent']) assert.match(t[k], /^#[0-9A-F]{6}$/i, `${t.id}.${k}`);
  }
  assert.equal(T.themeById('nope').id, T.DEFAULT_THEME, 'an unknown id falls back to the default');
});

test('colour maths', () => {
  assert.equal(T.mix('#000000', '#FFFFFF', 0.5), '#808080');
  assert.equal(T.mix('#112233', '#FFFFFF', 0), '#112233');
  assert.deepEqual(T.hexToRgb('#0F766E'), [15, 118, 110]);
  assert.equal(T.hexToRgb('#fff').join(), '255,255,255');
  assert.ok(Math.abs(T.contrast('#000000', '#FFFFFF') - 21) < 0.01);
  const [h] = T.rgbToHsl(T.hexToRgb('#FF0000'));
  assert.equal(Math.round(h), 0);
  assert.equal(T.hueShift('#FF0000', 120), '#00FF00');
  assert.equal(T.hueShift('#FF0000', 360), '#FF0000');
});

test('every theme is readable: white on the main colour, dark text on every surface, soft secondary text', () => {
  for (const t of T.THEMES) {
    const c = T.deriveColors(t);
    assert.ok(T.contrast('#FFFFFF', c.primary) >= 4.5, `${t.id}: white on primary ${T.contrast('#FFFFFF', c.primary).toFixed(2)}`);
    assert.ok(T.contrast('#FFFFFF', c.dark) >= 7, `${t.id}: white on the dark shade`);
    for (const bg of ['#FFFFFF', c.cream, c.bg, c.bg2, c.soft]) {
      assert.ok(T.contrast(c.ink, bg) >= 14, `${t.id}: ink on ${bg}`);
      assert.ok(T.contrast(c.text2, bg) >= 10, `${t.id}: text2 on ${bg}`);
      assert.ok(T.contrast(c.muted, bg) >= 4.5, `${t.id}: muted text on ${bg} ${T.contrast(c.muted, bg).toFixed(2)}`);
    }
    assert.ok(T.contrast(c.primary, '#FFFFFF') >= 4.5, `${t.id}: the main colour is readable as text on white`);
  }
});

test('the surfaces are clean: nearly neutral and very light, so the theme colour is the only colour that shouts', () => {
  for (const t of T.THEMES) {
    const c = T.deriveColors(t);
    for (const k of ['cream', 'bg', 'bg2', 'bg3', 'bg4']) assert.ok(T.contrast(c[k], '#FFFFFF') < (k === 'bg4' ? 1.3 : 1.2), `${t.id}: ${k} is almost white`);
    const ch = T.hexToRgb(c.bg); // how far apart the colour channels are: a neutral grey has none
    assert.ok(Math.max(...ch) - Math.min(...ch) <= 14, `${t.id}: the page background is only a breath of colour`);
  }
});

test('themeVars gives every variable, plus rgb channels for translucent colours and tool colours', () => {
  const v = T.themeVars('teal');
  assert.equal(v['--t-primary'], '#0F766E');
  assert.equal(v['--t-primary-rgb'], '15, 118, 110');
  for (const k of ['dark', 'darker', 'mid', 'sage', 'soft', 'bg', 'ink', 'muted', 'line', 'tile', 'accent']) assert.match(v[`--t-${k}`], /^#[0-9A-F]{6}$/, k);
  for (const k of ['primary', 'dark', 'mid', 'sage', 'cream', 'accent', 'ink', 'shadow']) assert.match(v[`--t-${k}-rgb`], /^\d+, \d+, \d+$/, k);
  for (let i = 1; i <= 5; i++) { assert.match(v[`--t-g${i}`], /^linear-gradient\(/); assert.match(v[`--t-h${i}`], /^#[0-9A-F]{6}$/); assert.match(v[`--t-h${i}-soft`], /^#[0-9A-F]{6}$/); }
  assert.notDeepEqual(T.themeVars('teal'), T.themeVars('indigo'));
});

test('every tool gets its own bright colour from the theme colour wheel, whatever the theme', () => {
  for (const t of T.THEMES) {
    const { hues, grads } = T.toolColors(t.primary);
    assert.equal(hues.length, 5); assert.equal(new Set(hues).size, 5, `${t.id}: five different colours`);
    assert.equal(new Set(grads).size, 5);
    for (const h of hues) { const [, s, l] = T.rgbToHsl(T.hexToRgb(h)); assert.ok(s >= 0.6 && l > 0.4 && l < 0.55, `${t.id}: ${h} is vivid and mid-light`); }
  }
});

test('the header and mode bar are always clean white with dark text, so they are readable on any website', () => {
  for (const t of T.THEMES) {
    const v = T.themeVars(t.id);
    const c = T.deriveColors(t);
    assert.equal(v['--t-bar-bg'], '#FFFFFF');
    assert.equal(v['--t-bar-fg'], c.ink);
    assert.ok(T.contrast(v['--t-bar-fg'], '#FFFFFF') >= 14, `${t.id}: bar text`);
    assert.ok(T.contrast(v['--t-bar-fg2'], '#FFFFFF') >= 4.5, `${t.id}: secondary bar text`);
    assert.ok(T.contrast(v['--t-bar-on-fg'], v['--t-bar-on-bg']) >= 4.5, `${t.id}: the active tab`);
  }
});

test('applyTheme sets the variables on an element', () => {
  const el = new JSDOM('<div></div>').window.document.querySelector('div');
  T.applyTheme(el, 'rose');
  assert.equal(el.style.getPropertyValue('--t-primary'), '#E11D48');
  assert.equal(el.dataset.theme, 'rose');
  T.applyTheme(el, 'doesnotexist');
  assert.equal(el.dataset.theme, T.DEFAULT_THEME);
});

test('every theme variable the stylesheets use is defined, and the stylesheets carry the default theme (run scripts/sync-theme-css.mjs if this fails)', () => {
  const defined = new Set(Object.keys(T.themeVars(T.DEFAULT_THEME)));
  for (const f of SHEETS) {
    const text = css(f);
    const used = new Set([...text.matchAll(/var\((--t-[a-z0-9-]+)/g)].map((m) => m[1]));
    assert.ok(used.size > 5, `${f} uses theme variables`);
    for (const u of used) assert.ok(defined.has(u), `${f} uses ${u}, which no theme defines`);
    assert.ok(text.includes(T.themeCss(T.DEFAULT_THEME)), `${f} carries the default theme as its fallback`);
  }
});

test('the stylesheets no longer hard-code the old blue, olive or slate colours (use var(--t-*) so themes can change them)', () => {
  const OLD = ['#2563EB', '#1D4ED8', '#172554', '#EFF6FF', '#637545', '#455230', '#364123', '#7C8E5C', '#9BA685', '#C5CFAE', '#C9D1B4', '#DDE2CC', '#EEF0E1', '#EBEBD8',
    '#F6F6EC', '#F4F4E8', '#F1F1E4', '#EFEFE2', '#FBFBF4', '#1F2616', '#232B18', '#2D3522', '#3D4631', '#4F5740', '#5F6749', '#CDD1B8', '#DCDEC9', '#D4D7BF', '#D9DEC6',
    '#0F172A', '#111827', '#1E293B', '#334155', '#475569', '#64748B', '#94A3B8', '#CBD5E1', '#E2E8F0', '#F1F5F9', '#F8FAFC'];
  for (const f of SHEETS) {
    const text = css(f).replace(/\{[^}]*--t-[^}]*\}/, ''); // the default-theme block itself is allowed to hold literals
    for (const hex of OLD) assert.ok(!new RegExp(`${hex}\\b`, 'i').test(text), `${f} still hard-codes ${hex}`);
  }
});

test('the logo is the lens-and-pointer design: a master glyph, a themed toolbar icon for every theme and size, and an interface mark that follows the theme', async () => {
  const png = (rel) => { const b = readFileSync(new URL(`../../${rel}`, import.meta.url)); assert.equal(b.subarray(1, 4).toString(), 'PNG', rel + ' is a PNG'); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), type: b[25] }; };
  assert.deepEqual([png('design/logo/glyph-1024.png').w, png('design/logo/glyph-1024.png').h], [1024, 1024], 'the master');
  assert.deepEqual([png('public/icons/glyph.png').w, png('public/icons/glyph.png').h], [512, 512], 'the copy the interface uses');
  assert.equal(png('public/icons/glyph.png').type, 6, 'with transparency (RGBA)');
  for (const t of T.THEMES) for (const s of [16, 32, 48, 128]) {
    const i = png(`public/icons/themes/${t.id}/icon${s}.png`);
    assert.deepEqual([i.w, i.h], [s, s], `${t.id}/icon${s}.png is ${s}x${s}`);
    assert.equal(i.type, 6, `${t.id}/icon${s}.png keeps its transparent corners`);
  }
  for (const s of [16, 32, 48, 128]) assert.equal(readFileSync(new URL(`../../public/icons/icon${s}.png`, import.meta.url)).equals(readFileSync(new URL(`../../public/icons/themes/${T.DEFAULT_THEME}/icon${s}.png`, import.meta.url))), true, `the manifest icon ${s} is the default theme's`);
  const icons = await import('../../src/shared/icons.js');
  assert.match(icons.logoMark(40), /class="logo-mark" style="--lg:40px"/);
  for (const f of ['popup/popup.css', 'options/options.css']) { const c = css(f); assert.match(c, /\.logo-mark::after[^}]*mask: url\("\.\.\/icons\/glyph\.png"\)/); assert.match(c, /\.logo-mark \{[^}]*background: var\(--t-primary\)/); }
  assert.throws(() => readFileSync(new URL('../../src/shared/logo.js', import.meta.url)), 'the old drawn logo is gone');
});
