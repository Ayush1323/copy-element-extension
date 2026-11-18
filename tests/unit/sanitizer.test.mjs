import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadHtml } from './setup.mjs';

loadHtml('<!doctype html><body></body>');
const { sanitizeHtml, safeUrl } = await import('../../src/content/clipboard/html-sanitizer.js');

test('removes script/style/iframe and their content', () => {
  assert.equal(sanitizeHtml('<p>a<script>alert(1)</script><style>p{}</style><iframe src=x></iframe>b</p>'), '<p>ab</p>');
});
test('drops event handlers and inline styles, keeps allowed tags', () => {
  assert.equal(sanitizeHtml('<p onclick="x()" style="color:red"><strong class="k">hi</strong></p>'), '<p><strong>hi</strong></p>');
});
test('unwraps unknown wrappers and blocks javascript:/data: urls', () => {
  assert.equal(sanitizeHtml('<span>x <a href="javascript:alert(1)">bad</a> <a href="  JaVaScRiPt:alert(1)">bad2</a> <a href="data:text/html,x">d</a></span>'), 'x bad bad2 d');
  assert.equal(sanitizeHtml('<a href="https://a.com/x?y=1&z=2">ok</a>'), '<a href="https://a.com/x?y=1&amp;z=2" rel="noopener noreferrer">ok</a>');
  assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeUrl('vbscript:x'), '');
});
test('escapes text and removes images/forms', () => {
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)><form><input value=x></form>1 &lt; 2'), '1 &lt; 2');
});
