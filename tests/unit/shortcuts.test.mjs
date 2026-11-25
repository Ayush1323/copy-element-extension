import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const S = await import('../../src/shared/shortcuts.js');
const { MODES } = await import('../../src/shared/constants.js');
const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8'));

test('every tool has a shortcut, a command and a label, and nothing is listed twice', () => {
  const modes = Object.values(MODES).filter((m) => m !== 'text' || true);
  for (const m of modes) assert.ok(S.toolByMode(m), `${m} has a shortcut`);
  assert.equal(S.TOOLS.length, modes.length, 'one entry per tool');
  assert.equal(new Set(S.TOOLS.map((t) => t.mode)).size, S.TOOLS.length);
  assert.equal(new Set(S.TOOLS.map((t) => t.command)).size, S.TOOLS.length);
  assert.equal(new Set(S.TOOLS.map((t) => t.code + (t.shift ? '+Shift' : ''))).size, S.TOOLS.length, 'no two tools share a key');
  for (const t of S.TOOLS) { assert.ok(t.label); assert.equal(t.keys[0], 'Alt'); assert.equal(t.keys[t.keys.length - 1], t.code.replace('Key', '')); }
});

test('no tool uses a key the browser or LinkLens itself needs (Alt+D address bar, Alt+F menu, Alt+C copy, Alt+arrows back/forward, Alt+1-8 tabs)', () => {
  const taken = new Set(['KeyC', 'KeyD', 'KeyF', 'KeyL', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`)]);
  for (const t of S.TOOLS) assert.ok(!taken.has(t.code), `${t.label} uses ${t.code}`);
});

test('the manifest has a command for every tool; only the four allowed ones suggest a default key, and they match the table', () => {
  const cmds = manifest.commands;
  for (const t of S.TOOLS) {
    assert.ok(cmds[t.command], `manifest command ${t.command}`);
    assert.ok(cmds[t.command].description, `${t.command} has a description`);
  }
  assert.ok(cmds['copy-hovered']);
  const withKey = Object.entries(cmds).filter(([, c]) => c.suggested_key);
  assert.ok(withKey.length <= 4, 'Chrome allows at most four suggested default shortcuts: ' + withKey.length);
  for (const t of S.TOOLS) {
    const c = cmds[t.command];
    if (t.suggested) { assert.equal(c.suggested_key.default, t.keys.join('+')); assert.equal(c.suggested_key.mac, t.keys.join('+')); } else assert.ok(!c.suggested_key, `${t.command} has no suggested key (the user can assign one)`);
  }
  assert.equal(cmds['copy-hovered'].suggested_key.default, 'Alt+C');
  assert.equal(S.TOOLS.filter((t) => t.suggested).length + S.EXTRA.filter((x) => x.suggested).length, withKey.length, 'the table and the manifest agree on which have a default');
  for (const name of Object.keys(cmds)) assert.ok(S.toolByCommand(name) || name === 'copy-hovered', `${name} is handled`);
});

test('key events map to the right tool', () => {
  const ev = (code, o = {}) => ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...o });
  assert.equal(S.toolForEvent(ev('KeyU')).mode, 'textutils');
  assert.equal(S.toolForEvent(ev('KeyO')).mode, 'seo');
  assert.equal(S.toolForEvent(ev('KeyI')).mode, 'images');
  assert.equal(S.toolForEvent(ev('KeyM')).mode, 'measure');
  assert.equal(S.toolForEvent(ev('KeyK')).mode, 'card');
  assert.equal(S.toolForEvent(ev('KeyT')).mode, 'text');
  assert.equal(S.toolForEvent(ev('KeyE')).mode, 'element');
  assert.equal(S.toolForEvent(ev('KeyS')).mode, 'section', 'Alt+S is the section extractor');
  assert.equal(S.toolForEvent(ev('KeyS', { shiftKey: true })).mode, 'screenshot', 'Alt+Shift+S is the screenshot');
  assert.equal(S.toolForEvent(ev('KeyU', { shiftKey: true })), null, 'Shift changes the meaning');
  assert.equal(S.toolForEvent(ev('KeyU', { ctrlKey: true })), null);
  assert.equal(S.toolForEvent(ev('KeyU', { altKey: false })), null);
  assert.equal(S.toolForEvent(ev('KeyZ')), null);
  assert.equal(S.shortcutOf('textutils'), 'Alt+U'); assert.equal(S.shortcutOf('screenshot'), 'Alt+Shift+S'); assert.equal(S.shortcutOf('nope'), '');
  assert.equal(S.toolByCommand('activate-seo').mode, 'seo');
});
